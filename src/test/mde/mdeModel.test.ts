/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert'
import { Repository } from '../../../types/git'
import { getEmailHash } from '../../mde/mdeModel'

describe('mdeModel', async function () {
    describe('getEmailHash', async function () {
        it('returns undefined if no email is found', async function () {
            assert.strictEqual(
                await getEmailHash({
                    getConfig: async (repo?: Repository) => {
                        return {}
                    },
                }),
                undefined
            )
        })

        it('returns a hashed email', async function () {
            assert.strictEqual(
                await getEmailHash({
                    getConfig: async (repo?: Repository) => {
                        return { 'user.email': 'hashSlingingSlasher@asdf.com' }
                    },
                }),
                'ed2edc6bcfa2d82a9b6555203a6e98b456e8be433ebfed0e8e787b23cd4e1369'
            )
        })
    })
})