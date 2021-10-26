/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { IAM } from 'aws-sdk'
import { ExtContext } from '../../../shared/extensions'
import { createVueWebview } from '../../../webviews/main'
import * as nls from 'vscode-nls'
import { ext } from '../../../shared/extensionGlobals'
import { EnvironmentSettingsWizard, getAllInstanceDescriptions, SettingsForm } from '../../wizards/environmentSettings'
import { CreateEnvironmentRequest } from '../../../../types/clientmde'
import { getDevFiles, getRegistryDevFiles, promptDevFiles, PUBLIC_REGISTRY_URI } from '../../wizards/devfiles'
import { HttpResourceFetcher } from '../../../shared/resourcefetcher/httpResourceFetcher'
import { createCommands } from '../../../webviews/server'
import { GitExtension } from '../../../shared/extensions/git'
const localize = nls.loadMessageBundle()

export interface DefinitionTemplate {
    name: string
    source: string
}

// TODO: make submit a special case (the only method that is generic)
// that way we can compose commands and still be type-safe
const commands = createCommands({
    loadRoles,
    submit,
    cancel() {
        this.dispose()
    },
    editSettings,
    async loadTemplates() {
        return getRegistryDevFiles().then(t =>
            t.map(name => ({
                name,
                source: PUBLIC_REGISTRY_URI.with({ path: `devfiles/${name}` }).toString(),
            }))
        )
    },
    openDevfile,
    getAllInstanceDescriptions,
    listBranches,
})

export type Commands = typeof commands & { submit: (result: CreateEnvironmentRequest) => void } & {
    init: () => { url: string; branch?: string } | undefined
}

export async function createMdeWebview(
    context: ExtContext,
    repo?: { url: string; branch?: string }
): Promise<CreateEnvironmentRequest | undefined> {
    const submit = new Promise<CreateEnvironmentRequest | undefined>(async resolve => {
        await createVueWebview({
            id: 'createMde',
            cssFiles: ['base.css'],
            name: localize('AWS.command.createMdeForm.title', 'Create new development environment'),
            webviewJs: 'createMdeVue.js',
            context,
            onSubmit: resolve,
            commands: {
                ...commands,
                init: () => repo,
            },
        })
    })
    return submit
}

// TODO: where should we present errors?
// ideally the webview should validate all data prior to submission
// though in the off-chance that something slips through, it would be bad UX to dispose of
// the create form prior to a successful create

async function editSettings(data: SettingsForm) {
    const settingsWizard = new EnvironmentSettingsWizard(data)
    const response = await settingsWizard.run()
    return response
}

async function submit(data: CreateEnvironmentRequest) {
    if (data.sourceCode?.[0]?.uri) {
        const target = data.sourceCode[0]
        // TODO: remove this or have the git extension wrapper do it
        const targetNoSsh = target.uri.startsWith('ssh') ? target.uri.slice(6) : target.uri
        const devFiles = await getDevFiles({ name: 'origin', fetchUrl: targetNoSsh, branch: target.branch }).catch(
            () => {
                // swallow the error since prompting for devfiles is currently out-of-scope
                // later on we can refine this (display the error)
                return []
            }
        )
        const file =
            devFiles.length > 1
                ? await promptDevFiles({ name: 'origin', fetchUrl: targetNoSsh, branch: target.branch }, true)
                : {
                      filesystem: { path: devFiles[0] },
                  }
        // returns to webview
        if (!file) {
            throw new Error('User cancelled devfile prompt')
        }
        data.devfile ??= devFiles.length > 0 ? file : undefined
    } else {
        delete data.sourceCode
    }
    // Empty strings are not automatically stripped out
    if (data.devfile?.uri?.uri === '') {
        delete data.devfile
    }
}

// TODO: make this more robust by parsing the document then checking principals
// TODO: check 'Action' to see that the role can be assumed
const MDE_SERVICE_PRINCIPAL = 'moontide.aws.internal'

async function loadRoles(): Promise<IAM.Role[]> {
    const client = ext.toolkitClientBuilder.createIamClient('us-east-1') // hard-coded region for now

    // Not paginated
    try {
        return (await client.listRoles()).filter(r => r.AssumeRolePolicyDocument?.includes(MDE_SERVICE_PRINCIPAL))
    } catch (err) {
        vscode.window.showErrorMessage((err as Error).message)
        return []
    }
}

async function openDevfile(url: string | vscode.Uri) {
    url = typeof url === 'string' ? vscode.Uri.parse(url, true) : url
    if (url.scheme === 'http' || url.scheme === 'https') {
        const fetcher = new HttpResourceFetcher(url.toString(), { showUrl: true })
        fetcher.get().then(content => {
            vscode.workspace.openTextDocument({ language: 'yaml', content })
        })
    } else if (url.scheme === 'file') {
        vscode.workspace.openTextDocument(url)
    }
}

async function listBranches(url: string) {
    const git = GitExtension.instance
    const targetNoSsh = url.startsWith('ssh://') ? url.slice(6) : url
    const branches = await git.getBranchesForRemote({ name: 'User Input', fetchUrl: targetNoSsh, isReadOnly: true })
    return branches.filter(b => b.name !== undefined).map(b => b.name?.split('/').slice(1).join('/')) as string[]
}