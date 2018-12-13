/*
Copyright: Ambrosus Technologies GmbH
Email: tech@ambrosus.com

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

This Source Code Form is “Incompatible With Secondary Licenses”, as defined by the Mozilla Public License, v. 2.0.
*/

import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import {pick, put} from '../../src/utils/dict_utils';
import {createWeb3} from '../../src/utils/web3_tools';
import {ValidationError} from '../../src/errors/errors';

import IdentityManager from '../../src/services/identity_manager';
import BundleBuilder from '../../src/services/bundle_builder';

import {adminAccountWithSecret} from '../fixtures/account';
import {createFullAsset, createFullEvent, createFullBundle} from '../fixtures/assets_events';

import ScenarioBuilder from '../fixtures/scenario_builder';
import {getTimestamp} from '../../src/utils/time_utils';

chai.use(sinonChai);
const {expect} = chai;

describe('Bundle Builder', () => {
  let identityManager;
  let exampleAsset;
  let exampleEvent;
  let exampleBundle;

  before(async () => {
    identityManager = new IdentityManager(await createWeb3());
    exampleAsset = createFullAsset(identityManager);
    exampleEvent = createFullEvent(identityManager, {assetId: exampleAsset.assetId});
    exampleBundle = createFullBundle(identityManager, {}, [exampleAsset, exampleEvent]);
  });

  describe('validating', () => {
    let mockIdentityManager;
    let bundleBuilder;

    before(() => {
      mockIdentityManager = {
        validateSignature: sinon.stub(),
        checkHashMatches: sinon.stub()
      };
      bundleBuilder = new BundleBuilder(mockIdentityManager);
    });

    beforeEach(() => {
      mockIdentityManager.validateSignature.reset();
      mockIdentityManager.validateSignature.returns();
      mockIdentityManager.checkHashMatches.reset();
      mockIdentityManager.checkHashMatches.returns(true);
    });

    it('passes for proper bundle', () => {
      expect(() => bundleBuilder.validateBundle(exampleBundle)).to.not.throw();
    });

    for (const field of [
      'bundleId',
      'content',
      'content.signature',
      'content.idData',
      'content.idData.createdBy',
      'content.idData.timestamp',
      'content.idData.entriesHash',
      'content.entries']) {
      // eslint-disable-next-line no-loop-func
      it(`throws if the ${field} field is missing`, () => {
        const brokenBundle = pick(exampleBundle, field);
        expect(() => bundleBuilder.validateBundle(brokenBundle)).to.throw(ValidationError);
      });
    }

    it('checks if bundleId matches the hash of content (delegated to IdentityManager)', () => {
      mockIdentityManager.checkHashMatches.withArgs(exampleBundle.bundleId, exampleBundle.content).returns(false);
      expect(() => bundleBuilder.validateBundle(exampleBundle)).to.throw(ValidationError);
      expect(mockIdentityManager.checkHashMatches).to.have.been.calledWith(exampleBundle.bundleId, exampleBundle.content);
    });

    it('checks if entriesHash matches the hash of entries (delegated to IdentityManager)', () => {
      mockIdentityManager.checkHashMatches.withArgs(exampleBundle.content.idData.entriesHash, exampleBundle.content.entries).returns(false);
      expect(() => bundleBuilder.validateBundle(exampleBundle)).to.throw(ValidationError);
      expect(mockIdentityManager.checkHashMatches).to.have.been.calledWith(exampleBundle.content.idData.entriesHash, exampleBundle.content.entries);
    });

    it('checks if signature is correct (delegated to IdentityManager)', () => {
      expect(() => bundleBuilder.validateBundle(exampleBundle)).to.not.throw();
      expect(mockIdentityManager.validateSignature).to.have.been.calledOnce;
    });

    it('checks if signature is incorrect (delegated to IdentityManager)', () => {
      mockIdentityManager.validateSignature.throws(new ValidationError('Signature is invalid'));

      expect(() => bundleBuilder.validateBundle(exampleBundle)).to.throw(ValidationError);
      expect(mockIdentityManager.validateSignature).to.have.been.calledOnce;
    });

    it(`allow metadata field`, () => {
      const exampleBundleWithMetadata = put(exampleBundle, 'metadata', 'abc');
      expect(() => bundleBuilder.validateBundle(exampleBundleWithMetadata)).not.to.throw();
    });

    it(`doesn't allow root-level fields other than content, metadata and bundleId`, () => {
      const brokenBundle = put(exampleBundle, 'extraField', 'abc');
      expect(() => bundleBuilder.validateBundle(brokenBundle)).to.throw(ValidationError);
    });

    it(`doesn't allow content fields other than idData, and signature`, () => {
      const brokenBundle = put(exampleBundle, 'content.extraField', 'abc');
      expect(() => bundleBuilder.validateBundle(brokenBundle)).to.throw(ValidationError);
    });
  });

  describe('Assembling', () => {
    let mockIdentityManager;
    let mockEntityBuilder;

    let bundleBuilder;
    let scenario;

    let inAssets;
    let inEvents;
    let inTimestamp;
    const inSecret = 'inSecret';
    const mockAddress = 'mockAddress';
    const mockHash1 = 'mockHash1';
    const mockHash2 = 'mockHash2';
    const mockSignature = 'mockSignature';
    let inAssetsStripped;
    let inEventsStripped;
    let inEventsStubbed;

    let ret;

    before(async () => {
      mockIdentityManager = {
        calculateHash: sinon.stub(),
        sign: sinon.stub(),
        addressFromSecret: sinon.stub()
      };
      mockEntityBuilder = {
        prepareEventForBundlePublication: sinon.stub(),
        removeBundle: sinon.stub()
      };
      bundleBuilder = new BundleBuilder(mockIdentityManager, mockEntityBuilder);

      scenario = new ScenarioBuilder(identityManager);
      await scenario.addAdminAccount(adminAccountWithSecret);

      inAssets = [
        await scenario.addAsset(0),
        await scenario.addAsset(0)
      ];
      inEvents = [
        await scenario.addEvent(0, 0, {accessLevel: 0}),
        await scenario.addEvent(0, 1, {accessLevel: 0}),
        await scenario.addEvent(0, 1, {accessLevel: 1})
      ];
      inTimestamp = getTimestamp();
      const stripFunc = (entry) => put(entry, 'mock.bundleStripped', 1);
      inAssetsStripped = inAssets.map(stripFunc);
      inEventsStripped = inEvents.map(stripFunc);
      const prepFunc = (entry) => put(entry, 'mock.stub', 1);
      inEventsStubbed = inEventsStripped.map(prepFunc);

      mockIdentityManager.addressFromSecret.returns(mockAddress);
      mockIdentityManager.calculateHash.onFirstCall().returns(mockHash1);
      mockIdentityManager.calculateHash.onSecondCall().returns(mockHash2);
      mockIdentityManager.sign.returns(mockSignature);
      mockEntityBuilder.removeBundle.callsFake(stripFunc);
      mockEntityBuilder.prepareEventForBundlePublication.callsFake(prepFunc);

      ret = bundleBuilder.assembleBundle(inAssets, inEvents, inTimestamp, inSecret);
    });

    it('strips the bundleId metadata link using the removeBundle method', () => {
      expect(mockEntityBuilder.removeBundle).to.have.callCount(inAssets.length + inEvents.length);
    });

    it('calculates event stubs', () => {
      expect(mockEntityBuilder.prepareEventForBundlePublication).to.have.callCount(inEvents.length);
    });

    it('places event stubs and untouched assets into the entries field', () => {
      expect(ret.content.entries).to.deep.include.members(inAssetsStripped);
      expect(ret.content.entries).to.deep.include.members(inEventsStubbed);
      expect(ret.content.entries).to.have.lengthOf(inAssets.length + inEvents.length);
    });

    it('asks the identity manager for the address of the provided secret and put it into idData.createdBy', () => {
      expect(mockIdentityManager.addressFromSecret).to.have.been.calledWith(inSecret);
      expect(ret.content.idData.createdBy).to.be.equal(mockAddress);
    });

    it('puts the provided timestamp into idData.timestamp', () => {
      expect(ret.content.idData.timestamp).to.be.equal(inTimestamp);
    });

    it('orders the identity manager to calculate the entriesHash and put it into idData', () => {
      expect(mockIdentityManager.calculateHash).to.have.been.calledWith(ret.content.entries);
      expect(ret.content.idData.entriesHash).to.be.equal(mockHash1);
    });

    it('orders the identity manager to sign the the idData part', () => {
      expect(mockIdentityManager.sign).to.have.been.calledWith(inSecret, ret.content.idData);
      expect(ret.content.signature).to.be.equal(mockSignature);
    });

    it('orders the identity manager to calculate the bundleId', () => {
      expect(mockIdentityManager.calculateHash).to.have.been.calledWith(ret.content);
      expect(ret.bundleId).to.be.equal(mockHash2);
    });
  });
});