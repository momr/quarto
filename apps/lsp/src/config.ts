/*
 * configuration.ts
 *
 * Copyright (C) 2023 by Posit Software, PBC
 * Copyright (c) Microsoft Corporation. All rights reserved.
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { Connection, DidChangeConfigurationNotification, Emitter } from 'vscode-languageserver';

import { Disposable } from 'core';
import { MathjaxSupportedExtension } from 'editor-types';
import { 
	DiagnosticLevel, 
	DiagnosticOptions, 
	IncludeWorkspaceHeaderCompletions,
	LsConfiguration,
	defaultLsConfiguration,
	PreferredMdPathExtensionStyle
} from './service';

export type ValidateEnabled = 'ignore' | 'warning' | 'error' | 'hint';

export interface Settings {
	readonly workbench: {
		readonly colorTheme: string;
	};
	readonly quarto: {
		readonly path: string;
		readonly mathjax: {
			readonly scale: number;
			readonly extensions: MathjaxSupportedExtension[];
		}
	};
	readonly markdown: {
		readonly server: {
			readonly log: 'off' | 'debug' | 'trace';
		};

		readonly preferredMdPathExtensionStyle: 'auto' | 'includeExtension' | 'removeExtension';

		readonly suggest: {
			readonly paths: {
				readonly enabled: boolean;
				readonly includeWorkspaceHeaderCompletions: 'never' | 'onSingleOrDoubleHash' | 'onDoubleHash';
			};
		};

		readonly validate: {
			readonly enabled: boolean;
			readonly referenceLinks: {
				readonly enabled: ValidateEnabled;
			};
			readonly fragmentLinks: {
				readonly enabled: ValidateEnabled;
			};
			readonly fileLinks: {
				readonly enabled: ValidateEnabled;
				readonly markdownFragmentLinks: ValidateEnabled | 'inherit';
			};
			readonly ignoredLinks: readonly string[];
			readonly unusedLinkDefinitions: {
				readonly enabled: ValidateEnabled;
			};
			readonly duplicateLinkDefinitions: {
				readonly enabled: ValidateEnabled;
			};
		};
	};
}

function defaultSettings() : Settings {
	return {
		workbench: {
			colorTheme: 'Dark+'
		},
		quarto: {
			path: "",
			mathjax: {
				scale: 1,
				extensions: []
			}
		},
		markdown: {
			server: {
				log: 'off'
			},
			preferredMdPathExtensionStyle: 'auto',
			suggest: {
				paths: {
					enabled: true,
					includeWorkspaceHeaderCompletions: 'never'
				}
			},
			validate: {
				enabled: kDefaultDiagnosticOptions.enabled,
				referenceLinks: {
					enabled: kDefaultDiagnosticOptions.validateReferences!,
				},
				fragmentLinks: {
					enabled: kDefaultDiagnosticOptions.validateFragmentLinks!,
				},
				fileLinks: {
					enabled: kDefaultDiagnosticOptions.validateFileLinks!,
					markdownFragmentLinks: 'inherit',
				},
				ignoredLinks: [],
				unusedLinkDefinitions: {
					enabled: kDefaultDiagnosticOptions.validateUnusedLinkDefinitions!,
				},
				duplicateLinkDefinitions: {
					enabled: kDefaultDiagnosticOptions.validateDuplicateLinkDefinitions!
				}
			}
		}
	}
}


export class ConfigurationManager extends Disposable {

	private readonly _onDidChangeConfiguration = this._register(new Emitter<Settings>());
	public readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	private _settings: Settings;

	constructor(private readonly connection_: Connection) {
		super();
		this._settings = defaultSettings();
	}

	public async update() {
		this._settings = {
			...defaultSettings(),
			...(await this.connection_.workspace.getConfiguration())
		};
		this._onDidChangeConfiguration.fire(this._settings);
	}

	public async subscribe() {
		await this.update();
		await this.connection_.client.register(
			DidChangeConfigurationNotification.type,
			undefined
		);
		this.connection_.onDidChangeConfiguration(() => {
			this.update();
		});
	}

	public getSettings(): Settings {
		return this._settings;
	}
}

export function lsConfiguration(configManager: ConfigurationManager) : LsConfiguration {
	const config = defaultLsConfiguration();
	return {
		...config,
		get preferredMdPathExtensionStyle() {
			switch (configManager.getSettings().markdown.preferredMdPathExtensionStyle) {
				case 'includeExtension': return PreferredMdPathExtensionStyle.includeExtension;
				case 'removeExtension': return PreferredMdPathExtensionStyle.removeExtension;
				case 'auto':
				default:
					return PreferredMdPathExtensionStyle.auto;
			}
		},
		get includeWorkspaceHeaderCompletions() : IncludeWorkspaceHeaderCompletions {
			switch (configManager.getSettings().markdown.suggest.paths.includeWorkspaceHeaderCompletions || config.includeWorkspaceHeaderCompletions) {
				case 'onSingleOrDoubleHash': return IncludeWorkspaceHeaderCompletions.onSingleOrDoubleHash;
				case 'onDoubleHash': return IncludeWorkspaceHeaderCompletions.onDoubleHash;
				case 'never':
				default: return IncludeWorkspaceHeaderCompletions.never;
			}
		},
		get colorTheme(): "light" | "dark" {
			const settings = configManager.getSettings();
			return settings.workbench.colorTheme.includes("Light") ? "light" : "dark";
		},
		get mathjaxScale(): number {
			return configManager.getSettings().quarto.mathjax.scale;
		},
		get mathjaxExtensions(): readonly MathjaxSupportedExtension[] {
			return configManager.getSettings().quarto.mathjax.extensions;
		}
	}
}



export function getDiagnosticsOptions(configManager: ConfigurationManager): DiagnosticOptions {
	const settings = configManager.getSettings();
	if (!settings) {
		return kDefaultDiagnosticOptions;
	}

	const validateFragmentLinks = convertDiagnosticLevel(settings.markdown.validate.fragmentLinks.enabled);
	return {
		enabled: settings.markdown.validate.enabled,
		validateFileLinks: convertDiagnosticLevel(settings.markdown.validate.fileLinks.enabled),
		validateReferences: convertDiagnosticLevel(settings.markdown.validate.referenceLinks.enabled),
		validateFragmentLinks: convertDiagnosticLevel(settings.markdown.validate.fragmentLinks.enabled),
		validateMarkdownFileLinkFragments: settings.markdown.validate.fileLinks.markdownFragmentLinks === 'inherit' ? validateFragmentLinks : convertDiagnosticLevel(settings.markdown.validate.fileLinks.markdownFragmentLinks),
		validateUnusedLinkDefinitions: convertDiagnosticLevel(settings.markdown.validate.unusedLinkDefinitions.enabled),
		validateDuplicateLinkDefinitions: convertDiagnosticLevel(settings.markdown.validate.duplicateLinkDefinitions.enabled),
		ignoreLinks: settings.markdown.validate.ignoredLinks,
	};
}

export const kDefaultDiagnosticOptions: DiagnosticOptions = {
	enabled: false,
	validateFileLinks: DiagnosticLevel.ignore,
	validateReferences: DiagnosticLevel.ignore,
	validateFragmentLinks: DiagnosticLevel.ignore,
	validateMarkdownFileLinkFragments: DiagnosticLevel.ignore,
	validateUnusedLinkDefinitions: DiagnosticLevel.ignore,
	validateDuplicateLinkDefinitions: DiagnosticLevel.ignore,
	ignoreLinks: [],
};

function convertDiagnosticLevel(enabled: ValidateEnabled): DiagnosticLevel | undefined {
	switch (enabled) {
		case 'error': return DiagnosticLevel.error;
		case 'warning': return DiagnosticLevel.warning;
		case 'ignore': return DiagnosticLevel.ignore;
		case 'hint': return DiagnosticLevel.hint;
		default: return DiagnosticLevel.ignore;
	}
}

