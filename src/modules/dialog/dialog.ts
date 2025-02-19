/*!
 * Jodit Editor (https://xdsoft.net/jodit/)
 * Released under MIT see LICENSE.txt in the project root for license information.
 * Copyright (c) 2013-2022 Valeriy Chupurnov. All rights reserved. https://xdsoft.net
 */

/**
 * @module modules/dialog
 */

import './dialog.less';

import type {
	IControlType,
	IDictionary,
	IToolbarCollection,
	IContainer,
	IDialog,
	ContentItem,
	Content,
	IDialogOptions
} from '../../types/';
import { Config } from '../../config';
import { KEY_ESC } from '../../core/constants';
import {
	$$,
	asArray,
	attr,
	ConfigProto,
	css,
	hasContainer,
	isArray,
	isBoolean,
	isFunction,
	isString,
	isVoid,
	splitArray,
	toArray
} from '../../core/helpers/';
import { ViewWithToolbar } from '../../core/view/view-with-toolbar';
import { Dom } from '../../core/dom';
import { STATUSES } from '../../core/component';
import { eventEmitter, pluginSystem } from '../../core/global';
import { component, autobind, hook } from '../../core/decorators';
import { View } from '../../core/view/view';
import { Icon } from '../../core/ui';

declare module '../../config' {
	interface Config {
		dialog: IDialogOptions;
	}
}

Config.prototype.dialog = {
	namespace: '',
	extraButtons: [],

	/**
	 * This dialog can resize by trigger
	 */
	resizable: true,

	/**
	 * This dialog can move by header
	 */
	draggable: true,
	buttons: ['dialog.close'],
	removeButtons: []
};

Config.prototype.controls.dialog = {
	close: {
		icon: 'cancel',
		exec: dialog => {
			(dialog as Dialog).close();
			(dialog as Dialog).toggleFullSizeBox(false);
		}
	}
} as IDictionary<IControlType>;

/**
 * Module to generate dialog windows
 */
@component
export class Dialog extends ViewWithToolbar implements IDialog {
	/** @override */
	className(): string {
		return 'Dialog';
	}

	private resizer!: HTMLElement;
	override toolbar!: IToolbarCollection;

	private offsetX?: number;
	private offsetY?: number;

	private get destination(): HTMLElement {
		return this.od.body;
	}

	private destroyAfterClose: boolean = false;

	private moved: boolean = false;

	private iSetMaximization: boolean = false;

	private resizable: boolean = false;
	private draggable: boolean = false;
	private startX: number = 0;
	private startY: number = 0;
	private startPoint = { x: 0, y: 0, w: 0, h: 0 };

	private lockSelect = () => {
		this.setMod('moved', true);
	};

	private unlockSelect = () => {
		this.setMod('moved', false);
	};

	private setElements(root: HTMLElement, elements: Content) {
		const elements_list: HTMLElement[] = [];

		asArray<ContentItem | ContentItem[] | IContainer>(elements).forEach(
			(elm: ContentItem | ContentItem[] | IContainer): any => {
				if (isArray(elm)) {
					const div = this.c.div(this.getFullElName('column'));

					elements_list.push(div);
					root.appendChild(div);

					return this.setElements(div, elm);
				}

				let element: HTMLElement;

				if (isString(elm)) {
					element = this.c.fromHTML(elm);
				} else {
					element = hasContainer(elm) ? elm.container : elm;
				}

				elements_list.push(element);

				if (element.parentNode !== root) {
					root.appendChild(element);
				}
			}
		);

		toArray(root.childNodes).forEach((elm: ChildNode) => {
			if (elements_list.indexOf(elm as HTMLElement) === -1) {
				root.removeChild(elm);
			}
		});
	}

	@autobind
	private onMouseUp(): void {
		if (this.draggable || this.resizable) {
			this.e.off(this.ow, 'mousemove', this.onMouseMove);

			this.draggable = false;
			this.resizable = false;
			this.unlockSelect();

			if (this.e) {
				this.removeGlobalResizeListeners();

				/**
				 * Fired when dialog box is finished to resizing
				 */
				this.e.fire(this, 'endResize endMove');
			}
		}
	}

	/**
	 *
	 */
	@autobind
	private onHeaderMouseDown(e: MouseEvent): void {
		const target: HTMLElement = e.target as HTMLElement;

		if (
			!this.o.draggable ||
			(target && target.nodeName.match(/^(INPUT|SELECT)$/))
		) {
			return;
		}

		this.draggable = true;
		this.startX = e.clientX;
		this.startY = e.clientY;
		this.startPoint.x = css(this.dialog, 'left') as number;
		this.startPoint.y = css(this.dialog, 'top') as number;

		this.setMaxZIndex();
		e.preventDefault();

		this.lockSelect();

		this.addGlobalResizeListeners();

		if (this.e) {
			/**
			 * Fired when dialog box is started moving
			 */
			this.e.fire(this, 'startMove');
		}
	}

	@autobind
	private onMouseMove(e: MouseEvent) {
		if (this.draggable && this.o.draggable) {
			this.setPosition(
				this.startPoint.x + e.clientX - this.startX,
				this.startPoint.y + e.clientY - this.startY
			);

			if (this.e) {
				/**
				 * Fired when dialog box is moved
				 */
				this.e.fire(
					this,
					'move',
					e.clientX - this.startX,
					e.clientY - this.startY
				);
			}

			e.stopImmediatePropagation();
		}

		if (this.resizable && this.o.resizable) {
			this.setSize(
				this.startPoint.w + e.clientX - this.startX,
				this.startPoint.h + e.clientY - this.startY
			);

			if (this.e) {
				/**
				 * Fired when dialog box is resized
				 */
				this.e.fire(
					this,
					'resizeDialog',
					e.clientX - this.startX,
					e.clientY - this.startY
				);
			}
		}
	}

	@autobind
	private onEsc(e: KeyboardEvent): void {
		if (
			this.isOpened &&
			e.key === KEY_ESC &&
			this.getMod('static') !== true
		) {
			const me = this.getMaxZIndexDialog();

			if (me) {
				me.close();
			} else {
				this.close();
			}

			e.stopImmediatePropagation();
		}
	}

	private onResize = () => {
		if (
			this.options &&
			this.o.resizable &&
			!this.moved &&
			this.isOpened &&
			!this.offsetX &&
			!this.offsetY
		) {
			this.setPosition();
		}
	};

	@autobind
	private onResizerMouseDown(e: MouseEvent) {
		this.resizable = true;
		this.startX = e.clientX;
		this.startY = e.clientY;

		this.startPoint.w = this.dialog.offsetWidth;
		this.startPoint.h = this.dialog.offsetHeight;

		this.lockSelect();

		this.addGlobalResizeListeners();

		if (this.e) {
			/**
			 * Fired when dialog box is started resizing
			 */
			this.e.fire(this, 'startResize');
		}
	}

	private addGlobalResizeListeners(): void {
		const self = this;

		self.e
			.on(self.ow, 'mousemove', self.onMouseMove)
			.on(self.ow, 'mouseup', self.onMouseUp);
	}

	private removeGlobalResizeListeners(): void {
		const self = this;

		self.e
			.off(self.ow, 'mousemove', self.onMouseMove)
			.off(self.ow, 'mouseup', self.onMouseUp);
	}

	override OPTIONS!: IDialogOptions;

	dialog!: HTMLElement;

	workplace!: HTMLDivElement;

	private dialogbox_header!: HTMLElement;
	private dialogbox_content!: HTMLElement;
	private dialogbox_footer!: HTMLElement;
	private dialogbox_toolbar!: HTMLElement;

	/**
	 * Specifies the size of the window
	 *
	 * @param w - The width of the window
	 * @param h - The height of the window
	 */
	setSize(w?: number | string, h?: number | string): this {
		if (w == null) {
			w = this.dialog.offsetWidth;
		}

		if (h == null) {
			h = this.dialog.offsetHeight;
		}

		css(this.dialog, {
			width: w,
			height: h
		});

		return this;
	}

	/**
	 * Recalculate auto sizes
	 */
	calcAutoSize(): this {
		this.setSize('auto', 'auto');
		this.setSize();

		return this;
	}

	/**
	 * Specifies the position of the upper left corner of the window . If x and y are specified,
	 * the window is centered on the center of the screen
	 *
	 * @param x - Position px Horizontal
	 * @param y - Position px Vertical
	 */
	setPosition(x?: number, y?: number): this {
		const w = this.ow.innerWidth,
			h = this.ow.innerHeight;

		let left = w / 2 - this.dialog.offsetWidth / 2,
			top = h / 2 - this.dialog.offsetHeight / 2;

		if (left < 0) {
			left = 0;
		}

		if (top < 0) {
			top = 0;
		}

		if (x !== undefined && y !== undefined) {
			this.offsetX = x;
			this.offsetY = y;
			this.moved = Math.abs(x - left) > 100 || Math.abs(y - top) > 100;
		}

		this.dialog.style.left = (x || left) + 'px';
		this.dialog.style.top = (y || top) + 'px';

		return this;
	}

	/**
	 * Specifies the dialog box title . It can take a string and an array of objects
	 *
	 * @param content - A string or an HTML element ,
	 * or an array of strings and elements
	 * @example
	 * ```javascript
	 * var dialog = new Jodi.modules.Dialog(parent);
	 * dialog.setHeader('Hello world');
	 * dialog.setHeader(['Hello world', '<button>OK</button>', $('<div>some</div>')]);
	 * dialog.open();
	 * ```
	 */
	setHeader(content: Content): this {
		this.setElements(this.dialogbox_header, content);
		return this;
	}

	/**
	 * It specifies the contents of the dialog box. It can take a string and an array of objects
	 *
	 * @param content - A string or an HTML element ,
	 * or an array of strings and elements
	 * @example
	 * ```javascript
	 * var dialog = new Jodi.modules.Dialog(parent);
	 * dialog.setHeader('Hello world');
	 * dialog.setContent('<form onsubmit="alert(1);"><input type="text" /></form>');
	 * dialog.open();
	 * ```
	 */
	setContent(content: Content): this {
		this.setElements(this.dialogbox_content, content);
		return this;
	}

	/**
	 * Sets the bottom of the dialog. It can take a string and an array of objects
	 *
	 * @param content - A string or an HTML element ,
	 * or an array of strings and elements
	 * @example
	 * ```javascript
	 * var dialog = new Jodi.modules.Dialog(parent);
	 * dialog.setHeader('Hello world');
	 * dialog.setContent('<form><input id="someText" type="text" /></form>');
	 * dialog.setFooter([
	 *  $('<a class="jodit-button">OK</a>').click(function () {
	 *      alert($('someText').val())
	 *      dialog.close();
	 *  })
	 * ]);
	 * dialog.open();
	 * ```
	 */
	setFooter(content: Content): this {
		this.setElements(this.dialogbox_footer, content);
		this.setMod('footer', Boolean(content));
		return this;
	}

	/**
	 * Get zIndex from dialog
	 */
	getZIndex(): number {
		return parseInt(css(this.container, 'zIndex') as string, 10) || 0;
	}

	/**
	 * Get dialog instance with maximum z-index displaying it on top of all the dialog boxes
	 */
	getMaxZIndexDialog(): IDialog {
		let maxZi: number = 0,
			dlg: IDialog,
			zIndex: number,
			res: IDialog = this;

		$$('.jodit-dialog', this.destination).forEach((dialog: HTMLElement) => {
			dlg = (dialog as any).component as Dialog;
			zIndex = parseInt(css(dialog, 'zIndex') as string, 10);

			if (dlg.isOpened && !isNaN(zIndex) && zIndex > maxZi) {
				res = dlg;
				maxZi = zIndex;
			}
		});

		return res;
	}

	/**
	 * Sets the maximum z-index dialog box, displaying it on top of all the dialog boxes
	 */
	setMaxZIndex(): void {
		let maxZIndex: number = 20000004,
			zIndex: number = 0;

		$$('.jodit-dialog', this.destination).forEach(dialog => {
			zIndex = parseInt(css(dialog, 'zIndex') as string, 10);
			maxZIndex = Math.max(isNaN(zIndex) ? 0 : zIndex, maxZIndex);
		});

		this.container.style.zIndex = (maxZIndex + 1).toString();
	}

	/**
	 * Expands the dialog on full browser window
	 */
	maximization(condition?: boolean): boolean {
		if (isVoid(condition)) {
			condition = !this.getMod('fullsize');
		}

		this.setMod('fullsize', condition);

		this.toggleFullSizeBox(condition);
		this.iSetMaximization = condition;

		return condition;
	}

	toggleFullSizeBox(condition: boolean): void {
		[this.destination, this.destination.parentNode].forEach(box => {
			box &&
				(box as HTMLElement).classList &&
				(box as HTMLElement).classList.toggle(
					'jodit_fullsize-box_true',
					condition
				);
		});
	}

	open(destroyAfterClose: boolean): this;

	open(destroyAfterClose: boolean, modal: boolean): this;

	open(
		content?: Content,
		title?: Content,
		destroyAfterClose?: boolean,
		modal?: boolean
	): this;

	/**
	 * It opens a dialog box to center it, and causes the two event.
	 *
	 * @param contentOrClose - specifies the contents of the dialog box.
	 * Can be false or undefined. see `{@link Dialog~setContent|setContent}`
	 * @param title - specifies the title of the dialog box, @see setHeader
	 * @param destroyAfterClose - true - After closing the window , the destructor will be called.
	 * @param modal - true window will be opened in modal mode
	 */
	open(
		contentOrClose?: Content | boolean,
		titleOrModal?: Content | boolean,
		destroyAfterClose?: boolean,
		modal?: boolean
	): this {
		eventEmitter.fire('closeAllPopups hideHelpers');

		/**
		 * Called before the opening of the dialog box
		 */
		if (this.e.fire(this, 'beforeOpen') === false) {
			return this;
		}

		if (isBoolean(contentOrClose)) {
			destroyAfterClose = contentOrClose;
		}

		if (isBoolean(titleOrModal)) {
			modal = titleOrModal;
		}

		this.destroyAfterClose = destroyAfterClose === true;

		const content = isBoolean(contentOrClose) ? undefined : contentOrClose;
		const title = isBoolean(titleOrModal) ? undefined : titleOrModal;

		if (title !== undefined) {
			this.setHeader(title);
		}

		if (content) {
			this.setContent(content);
		}

		this.setMod('active', true);
		this.isOpened = true;

		this.setModal(modal);

		this.destination.appendChild(this.container);

		this.setPosition(this.offsetX, this.offsetY);

		this.setMaxZIndex();

		if (this.o.fullsize) {
			this.maximization(true);
		}

		/**
		 * Called after the opening of the dialog box
		 */
		this.e.fire('afterOpen', this);

		return this;
	}

	private isModal: boolean = false;

	/**
	 * Set modal mode
	 */
	setModal(modal: undefined | boolean): this {
		this.isModal = Boolean(modal);
		this.setMod('modal', this.isModal);

		return this;
	}

	/**
	 * True, if dialog was opened
	 */
	isOpened: boolean = false;

	/****
	 * Closes the dialog box , if you want to call the method `destruct`
	 *
	 * @see destroy
	 * @example
	 * ```javascript
	 * //You can close dialog two ways
	 * var dialog = new Jodit.modules.Dialog();
	 * dialog.open('Hello world!', 'Title');
	 * var $close = dialog.create.fromHTML('<a href="#" style="float:left;" class="jodit-button">
	 *     <i class="icon icon-check"></i>&nbsp;' + Jodit.prototype.i18n('Ok') + '</a>');
	 * $close.addEventListener('click', function () {
	 *     dialog.close();
	 * });
	 * dialog.setFooter($close);
	 * // and second way, you can close dialog from content
	 * dialog.open('<a onclick="var event = doc.createEvent('HTMLEvents'); event.initEvent('close_dialog', true, true);
	 * this.dispatchEvent(event)">Close</a>', 'Title');
	 * ```
	 */
	@autobind
	close(e?: MouseEvent): this {
		if (
			this.isDestructed ||
			!this.isOpened ||
			this.getMod('static') === true
		) {
			return this;
		}

		if (e) {
			e.stopImmediatePropagation();
			e.preventDefault();
		}

		/**
		 * Called up to close the window
		 */
		if (this.e && this.e.fire('beforeClose', this) === false) {
			return this;
		}

		this.setMod('active', false);

		this.isOpened = false;

		this.e.fire('toggleFullSize', false);
		if (this.iSetMaximization) {
			this.maximization(false);
		}

		Dom.safeRemove(this.container);

		this.removeGlobalResizeListeners();

		if (this.destroyAfterClose) {
			this.destruct();
		}

		/**
		 * It called after the window is closed
		 */
		this.e?.fire(this, 'afterClose');
		this.e?.fire(this.ow, 'joditCloseDialog');

		return this;
	}

	constructor(options?: Partial<IDialogOptions>) {
		super(options);

		const self: Dialog = this;

		self.options = ConfigProto(
			options ?? {},

			ConfigProto(
				{
					toolbarButtonSize: 'middle'
				},
				ConfigProto(Config.prototype.dialog, View.defaultOptions)
			)
		) as IDialogOptions;

		Dom.safeRemove(self.container);

		const n = this.getFullElName.bind(this);

		self.container = this.c.fromHTML(
			`<div style="z-index:${self.o.zIndex}" class="jodit jodit-dialog ${
				this.componentName
			}">
				<div class="${n('overlay')}"></div>
				<div class="${this.getFullElName('panel')}">
					<div class="${n('header')}">
						<div class="${n('header-title')}"></div>
						<div class="${n('header-toolbar')}"></div>
					</div>
					<div class="${n('content')}"></div>
					<div class="${n('footer')}"></div>
					${
						self.o.resizable
							? `<div class="${n('resizer')}">${Icon.get(
									'resize_handler'
							  )}</div>`
							: ''
					}
				</div>
			</div>`
		) as HTMLDivElement;

		attr(self.container, 'role', 'dialog');

		Object.defineProperty(self.container, 'component', {
			value: this
		});

		self.setMod('theme', self.o.theme || 'default');
		self.dialog = self.getElm('panel');

		css(self.dialog, {
			maxWidth: self.options.maxWidth,
			minHeight: self.options.minHeight,
			minWidth: self.options.minWidth
		});

		self.resizer = self.getElm('resizer');
		self.dialogbox_header = self.getElm('header-title');
		self.dialogbox_content = self.getElm('content');
		self.dialogbox_footer = self.getElm('footer');
		self.dialogbox_toolbar = self.getElm('header-toolbar');

		const headerBox = self.getElm('header');

		headerBox && self.e.on(headerBox, 'mousedown', self.onHeaderMouseDown);

		if (self.o.resizable) {
			self.e.on(self.resizer, 'mousedown', self.onResizerMouseDown);
		}

		const fullSize = pluginSystem.get('fullsize') as Function;
		isFunction(fullSize) && fullSize(self);

		this.e
			.on(self.container, 'close_dialog', self.close)
			.on(this.ow, 'keydown', this.onEsc)
			.on(this.ow, 'resize', this.onResize);
	}

	/**
	 * Build toolbar after ready
	 */
	@hook('ready')
	protected override buildToolbar(): void {
		this.o.buttons &&
			this.toolbar
				.build(splitArray(this.o.buttons))
				.setMod('mode', 'header')
				.appendTo(this.dialogbox_toolbar);
	}

	/**
	 * It destroys all objects created for the windows and also includes all the handlers for the window object
	 */
	override destruct(): void {
		if (this.isInDestruct) {
			return;
		}

		this.setStatus(STATUSES.beforeDestruct);

		if (this.isOpened) {
			this.close();
		}

		if (this.events) {
			this.removeGlobalResizeListeners();

			this.events
				.off(this.container, 'close_dialog', self.close)
				.off(this.ow, 'keydown', this.onEsc)
				.off(this.ow, 'resize', this.onResize);
		}

		super.destruct();
	}
}
