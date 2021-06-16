/*!
 * Jodit Editor (https://xdsoft.net/jodit/)
 * Released under MIT see LICENSE.txt in the project root for license information.
 * Copyright (c) 2013-2021 Valeriy Chupurnov. All rights reserved. https://xdsoft.net
 */

import type { IControlType, IJodit } from '../../types';
import { Config } from '../../config';
import { getContainer } from '../../core/global';
import { Dom } from '../../core/dom';
import { defaultLanguage } from '../../core/helpers';
import * as consts from '../../core/constants';

Config.prototype.controls.print = {
	exec: (editor: IJodit) => {
		const iframe = editor.create.element('iframe');
		var my_int = 0;
		iframe.addEventListener("load", function() {
			if (iframe.contentWindow && (my_int>0)){
				iframe.contentWindow.print();
			}
			my_int++;
		});

		Object.assign(iframe.style, {
			position: 'fixed',
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			border: 0
		});

		getContainer(editor, Config).appendChild(iframe);

		const afterFinishPrint = () => {
			editor.e.off(editor.ow, 'mousemove', afterFinishPrint);
			Dom.safeRemove(iframe);
		};


		const mywindow = iframe.contentWindow;

		if (mywindow) {



			editor.e
				.on(mywindow, 'onbeforeunload onafterprint', afterFinishPrint)
				.on(editor.ow, 'mousemove', afterFinishPrint);

			mywindow.document.write(
				'<!doctype html><html lang="' +
					defaultLanguage(editor.o.language) +
					'"><head><title></title></head>' +
					'<body>' +
					editor.value +
					'</body></html>'
			);
			mywindow.document.close();
			

			mywindow.focus();
			
			

		}
	},
	mode: consts.MODE_SOURCE + consts.MODE_WYSIWYG,
	tooltip: 'Print'
} as IControlType;

export function print(editor: IJodit): void {
	editor.registerButton({
		name: 'print'
	});
}
