/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';

registerAction2(class CopyMatchCommandAction extends Action2 {

	constructor(
	) {
		super({
			id: 'foo',
			title: 'bar',
		});

	}

	override async run(accessor: ServicesAccessor): Promise<any> {
	}
});
