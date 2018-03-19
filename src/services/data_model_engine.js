import {NotFoundError, InvalidParametersError, PermissionError} from '../errors/errors';

export default class DataModelEngine {
  constructor(identityManager, tokenAuthenticator, entityBuilder, entityRepository, proofRepository, accountRepository, accountAccessDefinitions) {
    this.identityManager = identityManager;
    this.tokenAuthenticator = tokenAuthenticator;
    this.entityBuilder = entityBuilder;
    this.entityRepository = entityRepository;
    this.proofRepository = proofRepository;
    this.accountRepository = accountRepository;
    this.accountAccessDefinitions = accountAccessDefinitions;
  }

  async createAdminAccount(account = this.identityManager.createKeyPair()) {
    const accounts = await this.accountRepository.count();
    if (accounts > 0) {
      throw new Error('Admin account already exist.');
    }
    const accountWithPermissions = {
      ...account,
      permissions: this.accountAccessDefinitions.defaultAdminPermissions()
    };
    await this.accountRepository.store(accountWithPermissions);
    return account;
  }

  async addAccount(accountRequest, tokenData) {
    await this.accountAccessDefinitions.ensureHasPermission(tokenData.createdBy, 'register_account');
    this.accountAccessDefinitions.validateAddAccountRequest(accountRequest);

    const accountToStore = {
      address: accountRequest.address,
      permissions: accountRequest.permissions,
      registeredBy : tokenData.createdBy,
      accessLevel: accountRequest.accessLevel
    };
    await this.accountRepository.store(accountToStore);
    return accountToStore;
  }

  async getAccount(address, tokenData) {
    const sender = await this.accountRepository.get(tokenData.createdBy);
    if (!sender) {
      throw new PermissionError(`Sender account ${address} not found.`);
    }
    const result = await this.accountRepository.get(address);
    if (!result) {
      throw new NotFoundError(`Account ${address} not found.`);
    }
    return result;
  }

  async modifyAccount(accountToChange, accountRequest, tokenData) {
    await this.accountAccessDefinitions.ensureHasPermission(tokenData.createdBy, 'register_account');
    this.accountAccessDefinitions.validateModifyAccountRequest(accountRequest);
    await this.getAccount(accountToChange, tokenData);
    return await this.accountRepository.update(accountToChange, accountRequest);
  }

  async createAsset(asset) {
    this.entityBuilder.validateAsset(asset);
    const {createdBy: creatorAddress} = asset.content.idData;

    await this.accountAccessDefinitions.ensureHasPermission(creatorAddress, 'create_entity');

    const augmentedAsset = this.entityBuilder.setBundle(asset, null);
    await this.entityRepository.storeAsset(augmentedAsset);

    return augmentedAsset;
  }

  async getAsset(assetId) {
    const asset = await this.entityRepository.getAsset(assetId);
    if (asset === null) {
      throw new NotFoundError(`No asset with id = ${assetId} found`);
    }
    return asset;
  }

  async createEvent(event) {
    this.entityBuilder.validateEvent(event);
    const {createdBy: creatorAddress, assetId} = event.content.idData;

    await this.accountAccessDefinitions.ensureHasPermission(creatorAddress, 'create_entity');

    if (await this.entityRepository.getAsset(assetId) === null) {
      throw new InvalidParametersError(`Target asset with id=${assetId} doesn't exist`);
    }

    const augmentedEvent = this.entityBuilder.setBundle(event, null);
    await this.entityRepository.storeEvent(augmentedEvent);

    return augmentedEvent;
  }

  async getEvent(eventId, tokenData) {
    const accessLevel = await this.accountAccessDefinitions.getTokenCreatorAccessLevel(tokenData);
    const event = await this.entityRepository.getEvent(eventId, accessLevel);
    if (event === null) {
      throw new NotFoundError(`No event with id = ${eventId} found`);
    }
    return event;
  }

  async findEvents(params, tokenData) {
    const validatedParams = this.entityBuilder.validateAndCastFindEventsParams(params);
    const accessLevel = await this.accountAccessDefinitions.getTokenCreatorAccessLevel(tokenData);
    return this.entityRepository.findEvents(validatedParams, accessLevel);
  }

  async getBundle(bundleId) {
    const bundle = await this.entityRepository.getBundle(bundleId);
    if (bundle === null) {
      throw new NotFoundError(`No bundle with id = ${bundleId} found`);
    }
    return bundle;
  }

  async finaliseBundle(bundleStubId) {
    const notBundled = await this.entityRepository.beginBundle(bundleStubId);

    const nodeSecret = await this.identityManager.nodePrivateKey();
    const newBundle = this.entityBuilder.assembleBundle(notBundled.assets, notBundled.events, Date.now(), nodeSecret);

    await this.entityRepository.storeBundle(newBundle);

    await this.entityRepository.endBundle(bundleStubId, newBundle.bundleId);

    const {blockNumber} = await this.proofRepository.uploadProof(newBundle.bundleId);

    await this.entityRepository.storeBundleProofBlock(newBundle.bundleId, blockNumber);

    return newBundle;
  }
}
