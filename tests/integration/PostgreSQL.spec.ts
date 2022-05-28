require('dotenv').config();
import {expect} from 'chai';
import {Game} from '../../src/Game';
import {TestPlayers} from '../TestPlayers';
import {PostgreSQL} from '../../src/database/PostgreSQL';
import {Database} from '../../src/database/Database';
import {restoreTestDatabase} from '../utils/setup';
import {GameId} from '../../src/common/Types';
import {sleep} from '../TestingUtils';

/*
 How to set up this integration test.

 This test only works manually.
*/
class TestPostgreSQL extends PostgreSQL {
  public saveGamePromise: Promise<void> = Promise.resolve();

  constructor() {
    super({
      user: 'tfmtest',
      database: 'tfmtest',
      host: 'localhost',
      password: process.env.POSTGRES_INTEGRATION_TEST_PASSWORD,
    });
  }

  // Tests can wait for saveGamePromise since save() is called inside other methods.
  public override saveGame(game: Game): Promise<void> {
    this.saveGamePromise = super.saveGame(game);
    return this.saveGamePromise;
  }

  public async getSaveIds(gameId: GameId): Promise<Array<number>> {
    const res = await this.client.query('SELECT distinct save_id FROM games WHERE game_id = $1', [gameId]);
    const allSaveIds: Array<number> = [];
    res.rows.forEach((row) => {
      allSaveIds.push(row.save_id);
    });
    return Promise.resolve(allSaveIds);
  }

  public async tearDown() {
    return this.client.query('DROP TABLE games').then(() => {
      this.client.query('DROP TABLE game_results');
    }).catch((err) => {
      throw err;
    });
  }
}

describe('PostgreSQL', () => {
  let db: TestPostgreSQL;
  beforeEach(() => {
    db = new TestPostgreSQL();
    Database.getInstance = () => db;
    return db.initialize();
  });

  afterEach(() => {
    restoreTestDatabase();
    return db.tearDown();
  });

  it('game is saved', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    await new Promise<void>((resolve) => {
      db.getGames((err, allGames) => {
        expect(err).eq(undefined);
        expect(allGames).deep.eq(['game-id-1212']);
        resolve();
      });
    });
  });

  it('saveIds', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    const game = Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    expect(game.lastSaveId).eq(1);

    await db.saveGame(game);
    await db.saveGame(game);
    await db.saveGame(game);

    const allSaveIds = await db.getSaveIds(game.id);
    expect(allSaveIds).has.members([0, 1, 2, 3]);
  });

  it('purge', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    const game = Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    expect(game.lastSaveId).eq(1);

    await db.saveGame(game);
    await db.saveGame(game);
    await db.saveGame(game);

    expect(await db.getSaveIds(game.id)).has.members([0, 1, 2, 3]);

    db.cleanSaves(game.id);

    await sleep(1000);

    const saveIds = await db.getSaveIds(game.id);
    expect(saveIds).has.members([0, 3]);
  });

  it('gets player count by id', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    const game = Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    expect(game.lastSaveId).eq(1);

    db.getPlayerCount(game.id, (err, playerCount) => {
      expect(err).to.be.undefined;
      expect(playerCount).to.eq(1);
    });
  });

  it('does not find player count for game by id', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    const game = Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    expect(game.lastSaveId).eq(1);

    db.getPlayerCount('notfound', (err, playerCount) => {
      expect(err).to.be.undefined;
      expect(playerCount).to.be.undefined;
    });
  });

  it('cleanSaves', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    const game = Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    expect(game.lastSaveId).eq(1);

    await db.saveGame(game);
    await db.saveGame(game);
    await db.saveGame(game);

    expect(await db.getSaveIds(game.id)).has.members([0, 1, 2, 3]);

    db.cleanSaves(game.id);
    await sleep(500);
    const saveIds = await db.getSaveIds(game.id);
    expect(saveIds).has.members([0, 3]);
  });

  it('getGameVersion', async () => {
    const player = TestPlayers.BLACK.newPlayer();
    const game = Game.newInstance('game-id-1212', [player], player);
    await db.saveGamePromise;
    expect(game.lastSaveId).eq(1);

    player.megaCredits = 200;
    await db.saveGame(game);

    player.megaCredits = 300;
    await db.saveGame(game);

    player.megaCredits = 400;
    await db.saveGame(game);

    const allSaveIds = await db.getSaveIds(game.id);
    expect(allSaveIds).has.members([0, 1, 2, 3]);

    const serialized0 = await db.getGameVersion(game.id, 0);
    expect(serialized0.players[0].megaCredits).eq(0);

    const serialized1 = await db.getGameVersion(game.id, 1);
    expect(serialized1.players[0].megaCredits).eq(200);

    const serialized2 = await db.getGameVersion(game.id, 2);
    expect(serialized2.players[0].megaCredits).eq(300);

    const serialized3 = await db.getGameVersion(game.id, 3);
    expect(serialized3.players[0].megaCredits).eq(400);
  });
});
