// Copyright (C) 2018 ConsenSys AG
//
// This file is part of uPort Mobile App.
//
// uPort Mobile App is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// uPort Mobile App is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with uPort Mobile App.  If not, see <http://www.gnu.org/licenses/>.
//
import { call, select, fork, spawn } from 'redux-saga/effects'
import { expectSaga } from 'redux-saga-test-plan'
import * as matchers from 'redux-saga-test-plan/matchers'
import { throwError } from 'redux-saga-test-plan/providers'
import { Credentials } from 'uport-credentials'
import { decodeJWT } from 'did-jwt'
import {
  handle,
  disclosureRequest,
  authorizeDisclosure,
  notificationsAllowed,
  askForNotificationsPermissions
} from '../disclosureRequest.js'
import { createToken, verifyToken, WEEK, DAY } from 'uPortMobile/lib/sagas/jwt'
import {
  savePublicUport,
  refreshExternalUport
} from 'uPortMobile/lib/sagas/persona'
import { waitForUX } from 'uPortMobile/lib/utilities/performance'
import {
  updateActivity,
  updateInteractionStats,
  storeConnection
} from 'uPortMobile/lib/actions/uportActions'
import {
  registerDeviceForNotifications,
  sendLocalNotification,
  updateEndpointAddress
} from 'uPortMobile/lib/actions/snsRegistrationActions'
import { clearRequest } from 'uPortMobile/lib/actions/requestActions'
import { externalProfile } from 'uPortMobile/lib/selectors/requests'
import {
  currentAddress,
  currentIdentity,
  accountsForNetwork,
  hasPublishedDID,
  accountForClientIdAndNetwork,
  accountForClientIdSignerTypeAndNetwork,
  publicEncKey
} from 'uPortMobile/lib/selectors/identities'
import { working, errorMessage } from 'uPortMobile/lib/selectors/processStatus'
import {
  networkSettingsForAddress,
  networkSettings
} from 'uPortMobile/lib/selectors/chains'
import {
  requestedClaims,
  verifiedClaimsTokens
} from 'uPortMobile/lib/selectors/attestations'
import {
  endpointArn,
  skippedPushNotifications
} from 'uPortMobile/lib/selectors/snsRegistrationStatus'
import {
  createSubAccount,
  createKeyPairAccount,
  createDeviceKey
} from 'uPortMobile/lib/sagas/identitySaga'

import {
  credentialsFor
} from '../../jwt'
const tk = require('timekeeper')

const jwt = 'JWT'

describe('#handle()', () => {
  const rinkebyAddress = '2op3oXVofN6R12WorHRS3zzc9sumUfL5xT8'
  const kovanAddress = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
  const mainnetAddress = '2nQtiQG6Cgm1GYTBaaKAgr76uY7iSexUkqX'
  const rootAddress = `did:ethr:0xf3beac30c498d9e26865f34fcaa57dbb935b0d74`
  const clientId = `did:ethr:0xf3beac30c498d9e26865f34fcaa57dbb935b0d75`

  it('handle simple requestToken without an account', () => {
    const request = {
      target: rootAddress,
      validatedSignature: true,
      client_id: clientId,
      callback_url: 'https://chasqui.uport.me/bla/blas',
      verified: undefined,
      actType: 'none',
      req: jwt,
      requested: ['name', 'description']
    }
    const payload = {
      type: 'shareReq',
      iss: clientId,
      iat: 1485321133,
      callback: 'https://chasqui.uport.me/bla/blas',
      requested: ['name', 'description']
    }
    return expectSaga(handle, payload, jwt)
      .provide([
        [select(externalProfile, clientId), undefined],
        [select(currentAddress), rootAddress],
        [spawn(refreshExternalUport, {clientId: clientId}), undefined]
      ])
      .put(updateInteractionStats(rootAddress, clientId, 'request'))
      .spawn(refreshExternalUport, {clientId: clientId})
      .returns(request)
      .run()
  })

  describe(`actType='general'`, () => {
    it('handle simple requestToken for general account with default network', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x4',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: rinkebyAddress,
        actType: 'general',
        req: jwt,
        accountAuthorized: false,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'general',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(accountsForNetwork, '0x4'),
            [{ address: rinkebyAddress, parent: rootAddress }]
          ],
          [select(networkSettings), { address: rootAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, {clientId: clientId}), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, {clientId: clientId})
        .returns(request)
        .run()
    })

    describe('handle request with specific network', () => {
      it('uses correct account if it exists', () => {
        const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
        const request = {
          target: rootAddress,
          validatedSignature: true,
          client_id: clientId,
          network: '0x2a',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          account: kovanAddress,
          actType: 'general',
          accountAuthorized: false,
          req: jwt,
          requested: ['name', 'description']
        }
        const payload = {
          type: 'shareReq',
          net: '0x2a',
          act: 'general',
          iss: clientId,
          iat: 1485321133,
          callback: 'https://chasqui.uport.me/bla/blas',
          requested: ['name', 'description']
        }
        return expectSaga(handle, payload, jwt)
          .provide([
            [select(currentAddress), rootAddress],
            [select(networkSettings), { address: rootAddress }],
            [
              select(accountsForNetwork, '0x2a'),
              [
                { address: kovanAddress, parent: rootAddress },
                { address: other }
              ]
            ],
            [select(externalProfile, clientId), undefined],
            [spawn(refreshExternalUport, { clientId }), undefined]
          ])
          .put(updateInteractionStats(rootAddress, clientId, 'request'))
          .spawn(refreshExternalUport, { clientId })
          .returns(request)
          .run()
      })

      it('uses correct account if it exists', () => {
        const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
        const request = {
          target: rootAddress,
          validatedSignature: true,
          client_id: clientId,
          network: '0x2a',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          account: undefined,
          accountAuthorized: false,
          actType: 'general',
          req: jwt,
          requested: ['name', 'description']
        }
        const payload = {
          type: 'shareReq',
          net: '0x2a',
          act: 'general',
          iss: clientId,
          iat: 1485321133,
          callback: 'https://chasqui.uport.me/bla/blas',
          requested: ['name', 'description']
        }
        return expectSaga(handle, payload, jwt)
          .provide([
            [select(currentAddress), rootAddress],
            [select(networkSettings), { address: rootAddress }],
            [select(accountsForNetwork, '0x2a'), []],
            [select(externalProfile, clientId), undefined],
            [spawn(refreshExternalUport, { clientId }), undefined]
          ])
          .put(updateInteractionStats(rootAddress, clientId, 'request'))
          .spawn(refreshExternalUport, { clientId })
          .returns(request)
          .run()
      })

      it('uses current address if it matches the network', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const request = {
          validatedSignature: true,
          target: address,
          account: address,
          client_id: clientId,
          network: '0x2a',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          accountAuthorized: false,
          actType: 'general'
        }
        const payload = {
          type: 'shareReq',
          net: '0x2a',
          act: 'general',
          iss: clientId,
          iat: 1485321133,
          callback: 'https://chasqui.uport.me/bla/blas',
          requested: ['name', 'description']
        }
        return expectSaga(handle, payload, jwt)
          .provide([
            [select(currentAddress), address],
            [select(networkSettings), { address }],
            [
              select(accountsForNetwork, '0x2a'),
              [{ address }, { address: kovanAddress }]
            ],
            [select(externalProfile, clientId), undefined],
            [spawn(refreshExternalUport, { clientId }), undefined]
          ])
          .put(updateInteractionStats(address, clientId, 'request'))
          .spawn(refreshExternalUport, { clientId })
          .returns(request)
          .run()
      })
    })
  })

  describe('app specific accounts', () => {
    it('with pre-existing app-specific account uses correct sub identity', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x4',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: rinkebyAddress,
        actType: 'segregated',
        req: jwt,
        accountAuthorized: false,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'segregated',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(
              accountForClientIdSignerTypeAndNetwork,
              '0x4',
              clientId,
              'MetaIdentityManager'
            ),
            { address: rinkebyAddress, parent: rootAddress }
          ],
          [select(networkSettings), { address: rootAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, { clientId })
        .returns(request)
        .run()
    })

    it('with no pre-existing app-specific account', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x4',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: undefined,
        actType: 'segregated',
        accountAuthorized: false,
        req: jwt,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'segregated',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(
              accountForClientIdSignerTypeAndNetwork,
              '0x4',
              clientId,
              'MetaIdentityManager'
            ),
            null
          ],
          [select(networkSettings), { address: rootAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, { clientId })
        .returns(request)
        .run()
    })

    it('with unsupported network', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x16B2',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        actType: 'segregated',
        accountAuthorized: false,
        req: jwt,
        requested: ['name', 'description'],
        error: 'uPort does not support infuranet at the moment'
      }

      const payload = {
        type: 'shareReq',
        act: 'segregated',
        net: '0x16B2',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }

      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .returns(request)
        .run()
    })

    it('with identity manager on unsupported network', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x1',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        actType: 'segregated',
        accountAuthorized: false,
        req: jwt,
        requested: ['name', 'description'],
        error: 'uPort does not support smart contract accounts on mainnet at the moment'
      }

      const payload = {
        type: 'shareReq',
        act: 'segregated',
        net: '0x1',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }

      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .returns(request)
        .run()
    })
  })

  describe('keypair accounts', () => {
    it('with pre-existing keypair account uses correct account', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x1',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: mainnetAddress,
        accountAuthorized: false,
        actType: 'keypair',
        req: jwt,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'keypair',
        net: '0x1',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(
              accountForClientIdSignerTypeAndNetwork,
              '0x1',
              clientId,
              'KeyPair'
            ),
            { address: mainnetAddress, parent: rootAddress }
          ],
          [select(networkSettings), { address: mainnetAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, { clientId })
        .returns(request)
        .run()
    })

    it('with no pre-existing keypair account', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: '0x1',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: undefined,
        actType: 'keypair',
        accountAuthorized: false,
        req: jwt,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'keypair',
        net: '0x1',
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(
              accountForClientIdSignerTypeAndNetwork,
              '0x1',
              clientId,
              'KeyPair'
            ),
            null
          ],
          [select(networkSettings), { address: rootAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, { clientId })
        .returns(request)
        .run()
    })
  })

  describe('externally created accounts', () => {
    const network_id = '0xdeadbeef'
    it('with pre-existing externally created account uses correct sub identity', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: network_id,
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: rinkebyAddress,
        accountAuthorized: false,
        actType: 'devicekey',
        req: jwt,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'devicekey',
        net: network_id,
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(
              accountForClientIdSignerTypeAndNetwork,
              network_id,
              clientId,
              'MetaIdentityManager'
            ),
            { address: rinkebyAddress, parent: rootAddress }
          ],
          [select(networkSettings), { address: rootAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, { clientId })
        .returns(request)
        .run()
    })

    it('with no pre-existing externally created account', () => {
      const request = {
        target: rootAddress,
        validatedSignature: true,
        client_id: clientId,
        network: network_id,
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: undefined,
        actType: 'devicekey',
        accountAuthorized: false,
        req: jwt,
        requested: ['name', 'description']
      }
      const payload = {
        type: 'shareReq',
        act: 'devicekey',
        net: network_id,
        iss: clientId,
        iat: 1485321133,
        callback: 'https://chasqui.uport.me/bla/blas',
        requested: ['name', 'description']
      }
      return expectSaga(handle, payload, jwt)
        .provide([
          [select(currentAddress), rootAddress],
          [
            select(
              accountForClientIdSignerTypeAndNetwork,
              network_id,
              clientId,
              'MetaIdentityManager'
            ),
            null
          ],
          [select(networkSettings), { address: rootAddress }],
          [select(externalProfile, clientId), undefined],
          [spawn(refreshExternalUport, { clientId }), undefined]
        ])
        .put(updateInteractionStats(rootAddress, clientId, 'request'))
        .spawn(refreshExternalUport, { clientId })
        .returns(request)
        .run()
    })
  })
})

describe('#disclosureRequest()', () => {
  describe('with signed request token', () => {
    it('handle simple requestToken', () => {
      const address = '2op3oXVofN6R12WorHRS3zzc9sumUfL5xT8'
      const request = {
        id: 123,
        target: address,
        validatedSignature: true,
        client_id: '0x012',
        network: '0x4',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        account: address,
        actType: 'general',
        req: 'JWT',
        requested: ['name', 'description']
      }
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(waitForUX), undefined],
          [select(networkSettings), { address }],
          [select(externalProfile, '0x012'), undefined],
          [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
          [
            call(verifyToken, 'JWT'),
            {
              payload: {
                type: 'shareReq',
                // net: '0x4',
                iss: '0x012',
                iat: 1485321133,
                callback: 'https://chasqui.uport.me/bla/blas',
                requested: ['name', 'description']
              }
            }
          ],
          [select(hasPublishedDID, address), true]
        ])
        .put(updateInteractionStats(address, '0x012', 'request'))
        .spawn(refreshExternalUport, { clientId: '0x012' })
        .not.spawn(savePublicUport, { address })
        .returns(request)
        .run()
    })

    describe('identity not published to registry', () => {
      it('no persona process, trigger savePublicUport', () => {
        const address = '2op3oXVofN6R12WorHRS3zzc9sumUfL5xT8'
        const request = {
          id: 123,
          target: address,
          validatedSignature: true,
          client_id: '0x012',
          network: '0x4',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          account: address,
          actType: 'general'
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address }],
            [select(externalProfile, '0x012'), undefined],
            [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: '0x012',
                  iat: 1485321133,
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, address), false],
            [select(working, 'persona'), false],
            [select(errorMessage, 'persona'), null]
          ])
          .put(updateInteractionStats(address, '0x012', 'request'))
          .spawn(refreshExternalUport, { clientId: '0x012' })
          .spawn(savePublicUport, { address })
          .returns(request)
          .run()
      })

      it('persona working, should not trigger savePublicUport', () => {
        const address = '2op3oXVofN6R12WorHRS3zzc9sumUfL5xT8'
        const request = {
          id: 123,
          target: address,
          validatedSignature: true,
          client_id: '0x012',
          network: '0x4',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          account: address,
          actType: 'general'
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address }],
            [select(externalProfile, '0x012'), undefined],
            [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: '0x012',
                  iat: 1485321133,
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, address), false],
            [select(working, 'persona'), true],
            [select(errorMessage, 'persona'), null]
          ])
          .put(updateInteractionStats(address, '0x012', 'request'))
          .spawn(refreshExternalUport, { clientId: '0x012' })
          .not.spawn(savePublicUport, { address })
          .returns(request)
          .run()
      })

      it('persona error, should not trigger savePublicUport', () => {
        const address = '2op3oXVofN6R12WorHRS3zzc9sumUfL5xT8'
        const request = {
          id: 123,
          target: address,
          validatedSignature: true,
          client_id: '0x012',
          network: '0x4',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          account: address,
          actType: 'general'
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address }],
            [select(externalProfile, '0x012'), undefined],
            [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: '0x012',
                  iat: 1485321133,
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, address), false],
            [select(working, 'persona'), false],
            [select(errorMessage, 'persona'), 'Transaction not mined']
          ])
          .put(updateInteractionStats(address, '0x012', 'request'))
          .spawn(refreshExternalUport, { clientId: '0x012' })
          .not.spawn(savePublicUport, { address })
          .returns(request)
          .run()
      })
    })

    it('handle simple requestToken with legacy timestamp', () => {
      const address = '2op3oXVofN6R12WorHRS3zzc9sumUfL5xT8'
      const request = {
        id: 123,
        target: address,
        account: address,
        validatedSignature: true,
        client_id: '0x012',
        network: '0x4',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        req: 'JWT',
        legacyMS: true,
        requested: ['name', 'description'],
        actType: 'general'
      }
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(waitForUX), undefined],
          [select(networkSettings), { address }],
          [select(externalProfile, '0x012'), undefined],
          [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
          [
            call(verifyToken, 'JWT'),
            {
              payload: {
                type: 'shareReq',
                iss: '0x012',
                iat: 1485321133000,
                callback: 'https://chasqui.uport.me/bla/blas',
                requested: ['name', 'description']
              }
            }
          ],
          [select(hasPublishedDID, address), true]
        ])
        .put(updateInteractionStats(address, '0x012', 'request'))
        .spawn(refreshExternalUport, { clientId: '0x012' })
        .returns(request)
        .run()
    })

    describe('handle request with specific network', () => {
      it('uses correct sub identity', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
        const primary = '0x0102030408'
        const request = {
          id: 123,
          target: primary,
          account: address,
          validatedSignature: true,
          client_id: '0x012',
          network: '0x2a',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          actType: 'general'
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(accountsForNetwork, '0x2a'),
              [{ address, parent: primary }, { address: other }]
            ],
            [select(externalProfile, '0x012'), undefined],
            [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: '0x012',
                  iat: 1485321133,
                  net: '0x2a',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, '0x012', 'request'))
          .spawn(refreshExternalUport, { clientId: '0x012' })
          .returns(request)
          .run()
      })

      it('uses specified target if it matches the network', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const request = {
          id: 123,
          target: address,
          account: address,
          validatedSignature: true,
          client_id: '0x012',
          network: '0x2a',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          actType: 'general'
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address }],
            [
              select(accountsForNetwork, '0x2a'),
              [{ address: '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDY' }]
            ],
            [select(externalProfile, '0x012'), undefined],
            [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: '0x012',
                  iat: 1485321133,
                  net: '0x2a',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, address), true]
          ])
          .put(updateInteractionStats(address, '0x012', 'request'))
          .spawn(refreshExternalUport, { clientId: '0x012' })
          .returns(request)
          .run()
      })

      it('uses current address if it matches the network', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const request = {
          id: 123,
          validatedSignature: true,
          target: address,
          account: address,
          client_id: '0x012',
          network: '0x2a',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description'],
          actType: 'general'
        }
        const withTarget = { ...request, target: address }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address }],
            [select(externalProfile, '0x012'), undefined],
            [spawn(refreshExternalUport, { clientId: '0x012' }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: '0x012',
                  iat: 1485321133,
                  net: '0x2a',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, address), true]
          ])
          .put(updateInteractionStats(address, '0x012', 'request'))
          .spawn(refreshExternalUport, { clientId: '0x012' })
          .returns(withTarget)
          .run()
      })
    })

    describe('app specific accounts', () => {
      it('with pre-existing app-specific account uses correct sub identity', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const primary = '0x0102030408'
        const client_id = '0x012'
        const request = {
          id: 123,
          target: primary,
          account: address,
          validatedSignature: true,
          client_id,
          network: '0x2a',
          actType: 'segregated',
          accountAuthorized: false,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(
                accountForClientIdSignerTypeAndNetwork,
                '0x2a',
                client_id,
                'MetaIdentityManager'
              ),
              { address, parent: primary }
            ],
            [select(externalProfile, client_id), undefined],
            [spawn(refreshExternalUport, { clientId: client_id }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: client_id,
                  act: 'segregated',
                  iat: 1485321133,
                  net: '0x2a',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, client_id, 'request'))
          .spawn(refreshExternalUport, { clientId: client_id })
          .returns(request)
          .run()
      })

      it('with no pre-existing app-specific account', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
        const primary = '0x0102030408'
        const client_id = '0x012'
        const request = {
          id: 123,
          target: primary,
          account: undefined,
          validatedSignature: true,
          client_id,
          network: '0x2a',
          actType: 'segregated',
          accountAuthorized: false,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(
                accountForClientIdSignerTypeAndNetwork,
                '0x2a',
                client_id,
                'MetaIdentityManager'
              ),
              null
            ],
            [select(externalProfile, client_id), undefined],
            [spawn(refreshExternalUport, { clientId: client_id }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: client_id,
                  act: 'segregated',
                  iat: 1485321133,
                  net: '0x2a',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, client_id, 'request'))
          .spawn(refreshExternalUport, { clientId: client_id })
          .returns(request)
          .run()
      })
    })

    describe('keypair accounts', () => {
      it('with pre-existing keypair account uses correct sub identity', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const primary = '0x0102030408'
        const client_id = '0x012'
        const request = {
          id: 123,
          target: primary,
          account: address,
          validatedSignature: true,
          client_id,
          network: '0x1',
          actType: 'keypair',
          accountAuthorized: false,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(
                accountForClientIdSignerTypeAndNetwork,
                '0x1',
                client_id,
                'KeyPair'
              ),
              { address, parent: primary }
            ],
            [select(externalProfile, client_id), undefined],
            [spawn(refreshExternalUport, { clientId: client_id }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: client_id,
                  act: 'keypair',
                  iat: 1485321133,
                  net: '0x1',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, client_id, 'request'))
          .spawn(refreshExternalUport, { clientId: client_id })
          .returns(request)
          .run()
      })

      it('with no pre-existing app-specific account', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
        const primary = '0x0102030408'
        const client_id = '0x012'
        const request = {
          id: 123,
          target: primary,
          account: undefined,
          validatedSignature: true,
          client_id,
          network: '0x1',
          actType: 'keypair',
          accountAuthorized: false,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(
                accountForClientIdSignerTypeAndNetwork,
                '0x1',
                client_id,
                'KeyPair'
              ),
              null
            ],
            [select(externalProfile, client_id), undefined],
            [spawn(refreshExternalUport, { clientId: client_id }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: client_id,
                  act: 'keypair',
                  iat: 1485321133,
                  net: '0x1',
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, client_id, 'request'))
          .spawn(refreshExternalUport, { clientId: client_id })
          .returns(request)
          .run()
      })
    })

    describe('externally created accounts', () => {
      const network_id = '0xdeadbeef'
      it('with pre-existing externally created account uses correct sub identity', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const primary = '0x0102030408'
        const client_id = '0x012'
        const request = {
          id: 123,
          target: primary,
          account: address,
          validatedSignature: true,
          client_id,
          network: network_id,
          actType: 'devicekey',
          accountAuthorized: false,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(
                accountForClientIdSignerTypeAndNetwork,
                network_id,
                client_id,
                'MetaIdentityManager'
              ),
              { address, parent: primary }
            ],
            [select(externalProfile, client_id), undefined],
            [spawn(refreshExternalUport, { clientId: client_id }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: client_id,
                  act: 'devicekey',
                  iat: 1485321133,
                  net: network_id,
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, client_id, 'request'))
          .spawn(refreshExternalUport, { clientId: client_id })
          .returns(request)
          .run()
      })

      it('with no pre-existing externally created account', () => {
        const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
        const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
        const primary = '0x0102030408'
        const client_id = '0x012'
        const request = {
          id: 123,
          target: primary,
          account: undefined,
          validatedSignature: true,
          client_id,
          network: network_id,
          actType: 'devicekey',
          accountAuthorized: false,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        return expectSaga(
          disclosureRequest,
          { id: 123 },
          { query: { requestToken: 'JWT' } }
        )
          .provide([
            [call(waitForUX), undefined],
            [select(networkSettings), { address: primary }],
            [
              select(
                accountForClientIdSignerTypeAndNetwork,
                network_id,
                client_id,
                'MetaIdentityManager'
              ),
              null
            ],
            [select(externalProfile, client_id), undefined],
            [spawn(refreshExternalUport, { clientId: client_id }), undefined],
            [
              call(verifyToken, 'JWT'),
              {
                payload: {
                  type: 'shareReq',
                  iss: client_id,
                  act: 'devicekey',
                  iat: 1485321133,
                  net: network_id,
                  callback: 'https://chasqui.uport.me/bla/blas',
                  requested: ['name', 'description']
                }
              }
            ],
            [select(hasPublishedDID, primary), true]
          ])
          .put(updateInteractionStats(primary, client_id, 'request'))
          .spawn(refreshExternalUport, { clientId: client_id })
          .returns(request)
          .run()
      })
    })

    it('with no pre-existing account for network', () => {
      const address = '34ukSmiK1oA1C5Du8aWpkjFGALoH7nsHeDX'
      const other = '35A7s7LGbDxdsFpYYggjFjcbBHom7CGdgaL' // other identity on same network
      const primary = '0x0102030408'
      const client_id = '0x012'
      const request = {
        id: 123,
        target: primary,
        account: undefined,
        validatedSignature: true,
        client_id,
        network: '0x2a',
        actType: 'general',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        req: 'JWT',
        requested: ['name', 'description']
      }
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(waitForUX), undefined],
          [select(networkSettings), { address: primary }],
          [select(accountsForNetwork, '0x2a'), []],
          [select(externalProfile, client_id), undefined],
          [spawn(refreshExternalUport, { clientId: client_id }), undefined],
          [
            call(verifyToken, 'JWT'),
            {
              payload: {
                type: 'shareReq',
                iss: client_id,
                iat: 1485321133,
                net: '0x2a',
                callback: 'https://chasqui.uport.me/bla/blas',
                requested: ['name', 'description']
              }
            }
          ],
          [select(hasPublishedDID, primary), true]
        ])
        .put(updateInteractionStats(primary, client_id, 'request'))
        .spawn(refreshExternalUport, { clientId: client_id })
        .returns(request)
        .run()
    })

    it('throws an error if we do not support network', () => {
      const address = '2oDZvNUgn77w2BKTkd9qKpMeUo8EL94QL5V'
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(waitForUX), undefined],
          [select(networkSettings), { address }],
          [select(accountsForNetwork, '0x16B2'), []],
          [
            call(verifyToken, 'JWT'),
            {
              payload: {
                type: 'shareReq',
                iss: '0x012',
                iat: 1485321133,
                net: '0x16B2',
                callback: 'https://chasqui.uport.me/bla/blas',
                requested: ['name', 'description']
              }
            }
          ]
        ])
        .put(
          updateActivity(123, {
            error: 'uPort does not support infuranet at the moment'
          })
        )
        .returns(undefined)
        .run()
    })

    it('throws an error if we do not support network for identity manager accounts', () => {
      const address = '2oDZvNUgn77w2BKTkd9qKpMeUo8EL94QL5V'
      const client_id = '0x012'
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(waitForUX), undefined],
          [select(networkSettings), { address }],
          [select(accountForClientIdAndNetwork, '0x1', client_id), null],
          [
            call(verifyToken, 'JWT'),
            {
              payload: {
                type: 'shareReq',
                act: 'segregated',
                iss: '0x012',
                iat: 1485321133,
                net: '0x1',
                callback: 'https://chasqui.uport.me/bla/blas',
                requested: ['name', 'description']
              }
            }
          ]
        ])
        .put(
          updateActivity(123, {
            error: 'uPort does not support smart contract accounts on mainnet at the moment'
          })
        )
        .returns(undefined)
        .run()
    })

    it('handles wrong type of jwt', () => {
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(verifyToken, 'JWT'), { payload: { type: 'shareResp' } }]
        ])
        .put(updateActivity(123, { error: 'Request was not of correct type' }))
        .returns(undefined)
        .run()
    })

    it('handles invalid jwt', () => {
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [
            call(verifyToken, 'JWT'),
            throwError(
              new Error('Could not verify the signature of request')
            )
          ]
        ])
        .put(
          updateActivity(123, {
            error: 'Could not verify the signature of request'
          })
        )
        .returns(undefined)
        .run()
    })
  })

  describe('act=none', () => {
    it('does not return account', () => {
      const address = '0x0102030408'
      const client_id = '0x012'
      const request = {
        id: 123,
        target: address,
        validatedSignature: true,
        client_id,
        actType: 'none',
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        req: 'JWT',
        requested: ['name', 'description']
      }
      return expectSaga(
        disclosureRequest,
        { id: 123 },
        { query: { requestToken: 'JWT' } }
      )
        .provide([
          [call(waitForUX), undefined],
          [select(networkSettings), { address }],
          [select(externalProfile, client_id), undefined],
          [spawn(refreshExternalUport, { clientId: client_id }), undefined],
          [
            call(verifyToken, 'JWT'),
            {
              payload: {
                type: 'shareReq',
                iss: client_id,
                act: 'none',
                iat: 1485321133,
                callback: 'https://chasqui.uport.me/bla/blas',
                requested: ['name', 'description']
              }
            }
          ],
          [select(hasPublishedDID, address), true]
        ])
        .put(updateInteractionStats(address, client_id, 'request'))
        .spawn(refreshExternalUport, { clientId: client_id })
        .returns(request)
        .run()
    })
  })
})

describe('#authorizeDisclosure', () => {
  const client = { name: 'Canton of Zug' }
  describe('with signed request token', () => {
    describe('legacy client_id', () => {
      it('authorizes simple requestToken', () => {
        const address = '0x0102030405'
        const request = {
          id: 123,
          target: address,
          account: address,
          actType: 'general',
          validatedSignature: true,
          client_id: '0x012',
          nad: address,
          network: undefined,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        const payload = {
          aud: '0x012',
          type: 'shareResp',
          nad: address,
          req: 'JWT',
          own: { name: 'Friedrick Hayek', description: 'Monetary maven' }
        }

        tk.freeze(new Date(1492997057053))
        return expectSaga(authorizeDisclosure, request)
          .provide([
            [select(networkSettingsForAddress, address), {}],
            [select(externalProfile, request.client_id), client],
            [select(requestedClaims, request.requested),
              { name: 'Friedrick Hayek', description: 'Monetary maven' }],
            [call(createToken,
                address,
                payload,
                { expiresIn: 86400, issuer: address },
                'Provide requested information to Canton of Zug'
              ),
              'JWT']])
          .put(updateActivity(123, { authorizedAt: 1492997057053 }))
          .put(updateInteractionStats(address, '0x012', 'share'))
          .put(storeConnection(address, 'apps', '0x012'))
          .put(clearRequest())
          .call(
            createToken,
            address,
            payload,
            { expiresIn: 86400, issuer: address },
            'Provide requested information to Canton of Zug'
          )
          .returns({ access_token: 'JWT' })
          .run()
      })
    })

    describe('did client_id', () => {
      it('authorizes simple requestToken', () => {
        const address = '0x0102030405'
        const did = `did:uport:${address}`
        const client_id = 'did:eg:0x012'
        const publicKey = '03fdd57adec3d438ea237fe46b33ee1e016eda6b585c3e27ea66686c2ea5358479'
        const privateKey = '278a5de700e29faae8e40e366ec5012b5ec63d36ec77e8a2417154cc1d25383f'
        const credentials = new Credentials({ privateKey, did })
        const request = {
          id: 123,
          target: did,
          account: address,
          actType: 'general',
          validatedSignature: true,
          client_id,
          nad: address,
          network: undefined,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          req: 'JWT',
          requested: ['name', 'description']
        }
        const payload = {
          aud: client_id,
          type: 'shareResp',
          nad: address,
          req: 'JWT',
          own: { name: 'Friedrick Hayek', description: 'Monetary maven' }
        }

        tk.freeze(new Date(1492997057053))
        return expectSaga(authorizeDisclosure, request)
          .provide([
            [select(networkSettingsForAddress, address), {}],
            [select(externalProfile, request.client_id), client],
            [
              select(requestedClaims, request.requested),
              { name: 'Friedrick Hayek', description: 'Monetary maven' }
            ],
            [call(credentialsFor, did, undefined, { issuer: did }), credentials]
          ])
          .call(
            createToken,
            did,
            payload,
            { expiresIn: 86400, issuer: did },
            'Provide requested information to Canton of Zug'
          )
          .put(updateInteractionStats(did, client_id, 'share'))
          .put(storeConnection(did, 'apps', client_id))
          .put(updateActivity(123, { authorizedAt: 1492997057053 }))
          .put(clearRequest())
          .run()
          .then(result => expect(decodeJWT(result.returnValue.access_token).payload.iss).toEqual(did))
      })
    })

    describe('handle request with sub accounts', () => {
      it('authorizes request token with existing account', () => {
        const address = '0x0102030405'
        const primary = '0x0102030408'
        const request = {
          id: 123,
          target: primary,
          account: address,
          validatedSignature: true,
          client_id: '0x012',
          network: '0x4',
          nad: address,
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          requested: ['name', 'description']
        }
        const payload = {
          aud: '0x012',
          nad: address,
          type: 'shareResp',
          own: { name: 'Friedrick Hayek', description: 'Monetary maven' }
        }

        tk.freeze(new Date(1492997057053))
        return expectSaga(authorizeDisclosure, request)
          .provide([
            [
              select(networkSettingsForAddress, address),
              { address, parent: primary }
            ],
            [select(externalProfile, request.client_id), client],
            [
              select(requestedClaims, request.requested),
              { name: 'Friedrick Hayek', description: 'Monetary maven' }
            ],
            [
              call(
                createToken,
                primary,
                payload,
                { expiresIn: 86400, issuer: primary },
                'Provide requested information to Canton of Zug'
              ),
              'JWT'
            ]
          ])
          .put(updateActivity(123, { authorizedAt: 1492997057053 }))
          .put(updateInteractionStats(primary, '0x012', 'share'))
          .put(storeConnection(primary, 'apps', '0x012'))
          .call(
            createToken,
            primary,
            payload,
            { expiresIn: 86400, issuer: primary },
            'Provide requested information to Canton of Zug'
          )
          .put(clearRequest())
          .returns({ access_token: 'JWT' })
          .run()
      })

      it('authorizes request token for actType=none', () => {
        const address = '0x0102030405'
        const primary = '0x0102030408'
        const request = {
          id: 123,
          actType: 'none',
          target: primary,
          validatedSignature: true,
          client_id: '0x012',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          requested: ['name', 'description']
        }
        const payload = {
          aud: '0x012',
          type: 'shareResp',
          own: { name: 'Friedrick Hayek', description: 'Monetary maven' }
        }

        tk.freeze(new Date(1492997057053))
        return expectSaga(authorizeDisclosure, request)
          .provide([
            // [select(networkSettingsForAddress, address), {address, parent: primary}],
            [select(externalProfile, request.client_id), client],
            [
              select(requestedClaims, request.requested),
              { name: 'Friedrick Hayek', description: 'Monetary maven' }
            ],
            [
              call(
                createToken,
                primary,
                payload,
                { expiresIn: 86400, issuer: primary },
                'Provide requested information to Canton of Zug'
              ),
              'JWT'
            ]
          ])
          .put(updateActivity(123, { authorizedAt: 1492997057053 }))
          .put(updateInteractionStats(primary, '0x012', 'share'))
          .put(storeConnection(primary, 'apps', '0x012'))
          .call(
            createToken,
            primary,
            payload,
            { expiresIn: 86400, issuer: primary },
            'Provide requested information to Canton of Zug'
          )
          .put(clearRequest())
          .returns({ access_token: 'JWT' })
          .run()
      })

      it('authorizes request token for actType=none', () => {
        const address = '0x0102030405'
        const primary = '0x0102030408'
        const request = {
          id: 123,
          actType: 'none',
          target: primary,
          validatedSignature: true,
          client_id: '0x012',
          callback_url: 'https://chasqui.uport.me/bla/blas',
          verified: undefined,
          requested: ['name', 'description']
        }
        const payload = {
          aud: '0x012',
          type: 'shareResp',
          own: { name: 'Friedrick Hayek', description: 'Monetary maven' }
        }

        tk.freeze(new Date(1492997057053))
        return expectSaga(authorizeDisclosure, request)
          .provide([
            // [select(networkSettingsForAddress, address), {address, parent: primary}],
            [select(externalProfile, request.client_id), client],
            [
              select(requestedClaims, request.requested),
              { name: 'Friedrick Hayek', description: 'Monetary maven' }
            ],
            [
              call(
                createToken,
                primary,
                payload,
                { expiresIn: 86400, issuer: primary },
                'Provide requested information to Canton of Zug'
              ),
              'JWT'
            ]
          ])
          .put(updateActivity(123, { authorizedAt: 1492997057053 }))
          .put(updateInteractionStats(primary, '0x012', 'share'))
          .put(storeConnection(primary, 'apps', '0x012'))
          .call(
            createToken,
            primary,
            payload,
            { expiresIn: 86400, issuer: primary },
            'Provide requested information to Canton of Zug'
          )
          .put(clearRequest())
          .returns({ access_token: 'JWT' })
          .run()
      })
    })

    it('authorizes simple requestToken with push notifications', () => {
      const address = '0x0102030405'
      const encKey = 'PUBLIC_ENCRYPTION_KEY'
      const request = {
        id: 123,
        target: address,
        account: address,
        validatedSignature: true,
        client_id: '0x012',
        network: '0x4',
        nad: address,
        pushPermissions: true,
        callback_url: 'https://chasqui.uport.me/bla/blas',
        verified: undefined,
        req: 'JWT',
        requested: ['name', 'description']
      }
      const ENDPOINT_ARN = 'AWS://ENDPOINT'
      const pushPayload = {
        aud: '0x012',
        type: 'notifications',
        value: ENDPOINT_ARN
      }
      const payload = {
        aud: '0x012',
        nad: address,
        type: 'shareResp',
        req: 'JWT',
        publicEncKey: encKey,
        boxPub: encKey,
        own: { name: 'Friedrick Hayek', description: 'Monetary maven' },
        capabilities: ['PUSHTOKEN']
      }

      tk.freeze(new Date(1492997057053))
      return expectSaga(authorizeDisclosure, request)
        .provide([
          [select(networkSettingsForAddress, address), {}],
          [select(externalProfile, request.client_id), client],
          [call(notificationsAllowed), true],
          [select(endpointArn), ENDPOINT_ARN],
          [select(publicEncKey, address), encKey],
          [
            select(requestedClaims, request.requested),
            { name: 'Friedrick Hayek', description: 'Monetary maven' }
          ],
          [
            call(
              createToken,
              address,
              pushPayload,
              { expiresIn: 2 * WEEK + DAY, issuer: address },
              `Allow Canton of Zug to send your push notifications`
            ),
            'PUSHTOKEN'
          ],
          [
            call(
              createToken,
              address,
              payload,
              { expiresIn: 86400, issuer: address },
              'Provide requested information to Canton of Zug'
            ),
            'JWT'
          ]
        ])
        .put(updateActivity(123, { authorizedAt: 1492997057053 }))
        .put(updateInteractionStats(address, '0x012', 'share'))
        .put(storeConnection(address, 'apps', '0x012'))
        .put(clearRequest())
        .call(
          createToken,
          address,
          pushPayload,
          { expiresIn: 2 * WEEK + DAY, issuer: address },
          `Allow Canton of Zug to send your push notifications`
        )
        .call(
          createToken,
          address,
          payload,
          { expiresIn: 86400, issuer: address },
          'Provide requested information to Canton of Zug'
        )
        .returns({ access_token: 'JWT' })
        .run()
    })
  })
})
