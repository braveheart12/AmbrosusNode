import httpMocks from 'node-mocks-http';
import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import {createAccountHandler, getAccountHandler} from '../../src/routes/accounts';
import {accountWithSecret, adminAccountWithSecret, account} from '../fixtures/account';
import {put} from '../../src/utils/dict_utils';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const {expect} = chai;

describe('Accounts', () => {
  let mockModelEngine = null;
  let req = null;
  let res = null;

  beforeEach(async () => {
    mockModelEngine = {
      createAccount: sinon.stub(),
      getAccount: sinon.stub()
    };
    req = httpMocks.createRequest({});
    res = httpMocks.createResponse();
  });

  describe('creating account', () => {
    let injectedHandler;
    let mockAccount;
    const requestedPermissions = ['perm1', 'perm2'];
    const tokenData = {createdBy : adminAccountWithSecret.address, validUntil: 423543253453};
    const accountCreationRequest = {createdBy: tokenData.createdBy, permissions : requestedPermissions};

    beforeEach(async () => {
      mockAccount = put(accountWithSecret, {permissions : requestedPermissions, createdBy : adminAccountWithSecret.address});
      mockModelEngine.createAccount.resolves(mockAccount);
      req.body = accountCreationRequest;
      req.tokenData = tokenData;
      injectedHandler = createAccountHandler(mockModelEngine);
    });

    it('pushes json body into Data Model Engine and proxies result', async () => {
      await injectedHandler(req, res);

      expect(mockModelEngine.createAccount).to.have.been.calledWith(accountCreationRequest, tokenData);
    
      expect(res._getStatusCode()).to.eq(201);
      expect(res._isJSON()).to.be.true;
    });
  });

  describe('getting account by id', () => {
    let injectedHandler;
    let mockAccount;
    const accountPermissions = ['perm1', 'perm2'];
    const tokenData = {createdBy : adminAccountWithSecret.address, validUntil: 423543253453};

    beforeEach(async () => {
      mockAccount = put(account, {permissions : accountPermissions, createdBy : adminAccountWithSecret.address});
      mockModelEngine.createAccount.resolves(mockAccount);
      req.params.id = mockAccount.address;
      req.tokenData = tokenData;
      injectedHandler = getAccountHandler(mockModelEngine);
    });

    it('passes requested id to Data Model Engine and proxies result', async () => {
      await injectedHandler(req, res);

      expect(mockModelEngine.getAccount).to.have.been.calledWith(mockAccount.address, tokenData);
    
      expect(res._getStatusCode()).to.eq(200);
      expect(res._isJSON()).to.be.true;
    });
  });
});
