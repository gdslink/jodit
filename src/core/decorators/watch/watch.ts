/*!
 * Jodit Editor (https://xdsoft.net/jodit/)
 * Released under MIT see LICENSE.txt in the project root for license information.
 * Copyright (c) 2013-2022 Valeriy Chupurnov. All rights reserved. https://xdsoft.net
 */

/**
 * [[include:core/decorators/watch/README.md]]
 * @packageDocumentation
 * @module decorators/watch
 */

import type {
	CanUndef,
	DecoratorHandler,
	IComponent,
	IDictionary,
	IViewComponent
} from '../../../types';
import { isFunction, isPlainObject, isViewObject } from '../../helpers/checker';
import { ObservableObject } from '../../event-emitter';
import { STATUSES } from '../../component';
import { splitArray } from '../../helpers/array/split-array';
import { error } from '../../helpers/utils/error';

export function getPropertyDescriptor(
	obj: unknown,
	prop: string
): CanUndef<PropertyDescriptor> {
	let desc;

	do {
		desc = Object.getOwnPropertyDescriptor(obj, prop);
		obj = Object.getPrototypeOf(obj);
	} while (!desc && obj);

	return desc;
}

/**
 * Watch decorator. Added observer for some change in field value
 */
export function watch(
	observeFields: string[] | string,
	context?: object | ((c: IDictionary) => object)
): DecoratorHandler {
	return <T extends IComponent & IDictionary>(
		target: T,
		propertyKey: string
	) => {
		if (!isFunction(target[propertyKey])) {
			throw error('Handler must be a Function');
		}

		const process = (component: IComponent) => {
			const callback = (key: string, ...args: any[]): void | any => {
				if (!component.isInDestruct) {
					return (component as any)[propertyKey](key, ...args);
				}
			};

			splitArray(observeFields).forEach(field => {
				if (/:/.test(field)) {
					const [objectPath, eventName] = field.split(':');

					const view = isViewObject(component)
						? component
						: (component as unknown as IViewComponent).jodit;

					if (objectPath.length) {
						// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
						context = component.get<CanUndef<object>>(objectPath)!;
					}

					if (isFunction(context)) {
						context = context(component);
					}

					view.events.on(context || component, eventName, callback);

					if (!context) {
						view.events.on(eventName, callback);
					}

					view.hookStatus('beforeDestruct', () => {
						view.events
							.off(context || component, eventName, callback)
							.off(eventName, callback);
					});

					return;
				}

				const parts = field.split('.'),
					[key] = parts as unknown as Array<keyof IComponent>;

				let value: any = component[key];

				if (value instanceof ObservableObject) {
					value.on(`change.${field}`, callback);
				} else if (isPlainObject(value) && parts.length > 1) {
					const observe = ObservableObject.create(value, [key]);
					observe.on(`change.${field}`, callback);
					(component as any)[key] = observe;
				} else {
					const descriptor = getPropertyDescriptor(target, key);

					Object.defineProperty(component, key, {
						configurable: true,
						set(v: any): void {
							const oldValue = value;

							if (oldValue === v) {
								return;
							}

							value = v;
							if (descriptor && descriptor.set) {
								descriptor.set.call(component, v);
							}

							if (isPlainObject(value)) {
								value = ObservableObject.create(value, [key]);
								value.on('change.' + field, callback);
							}

							callback(key, oldValue, value);
						},
						get(): any {
							if (descriptor && descriptor.get) {
								return descriptor.get.call(component);
							}

							return value;
						}
					});
				}
			});
		};

		if (isFunction(target.hookStatus)) {
			target.hookStatus(STATUSES.ready, process);
		} else {
			process(target);
		}
	};
}

export default watch;
