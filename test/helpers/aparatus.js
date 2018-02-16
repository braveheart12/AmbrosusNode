import Server from '../../src/server';
import {connectToMongo} from '../../src/utils/db_utils';
import {createWeb3} from '../../src/utils/web3_tools';
import IdentityManager from '../../src/services/identity_manager';
import AccountRepository from '../../src/services/account_repository';
import EntityBuilder from '../../src/services/entity_builder';
import EntityRepository from '../../src/services/entity_repository';
import DataModelEngine from '../../src/services/data_model_engine';
import LinkHelper from '../../src/services/link_helper';
import chai from 'chai';
import chaiHttp from 'chai-http';

chai.use(chaiHttp);

export default class Aparatus {
  async start() {
    const {client, db} = await connectToMongo();
    this.client = client;
    this.db = db;
    this.web3 = await createWeb3();

    this.identityManager = new IdentityManager(this.web3);
    this.entityBuilder = new EntityBuilder(this.identityManager);
    this.entityRepository = new EntityRepository(db);
    this.accountRepository = new AccountRepository(db);
    this.modelEngine = new DataModelEngine(this.identityManager, this.entityBuilder, this.entityRepository, this.accountRepository);

    this.linkHelper = new LinkHelper();

    this.server = new Server(this.modelEngine, this.linkHelper);
    this.server.start();
    return this;
  }

  request() {
    return chai.request(this.server.server);
  }

  async stop() {
    await this.server.stop();
    await this.client.close();
  }
}