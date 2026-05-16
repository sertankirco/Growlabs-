import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createGameContext, registerPlayers } from '../../context/GameContext';
import { toUnifiedContext } from '../../context/UnifiedContext';
import { WORLD_CUP_PLAYERS } from '../../mock/MatchSimulator';
import { LiveMatchOrchestrator } from '../LiveMatchOrchestrator';

// Hızlı test için context kurulumu
function makeCtx() {
  const ctx = createGameContext();
  registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));
  return toUnifiedContext(ctx);
}

describe('LiveMatchOrchestrator', () => {

  describe('startSimulation', () => {
    it('random senaryo başlatılır ve matchId döner', async () => {
      const ctx    = makeCtx();
      const orch   = new LiveMatchOrchestrator(ctx.pipeline);
      const matchId = orch.startSimulation('random', 1000); // çok hızlı
      assert.ok(typeof matchId === 'string' && matchId.length > 0);
    });

    it('aynı matchId ile iki kez başlatılırsa hata fırlatır', () => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      orch.startSimulation('random', 1000, 'match-x');
      assert.throws(() => orch.startSimulation('random', 1000, 'match-x'), /zaten çalışıyor/);
    });

    it('final senaryosu da başlatılır', () => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      assert.doesNotThrow(() => orch.startSimulation('final', 1000));
    });
  });

  describe('stopMatch', () => {
    it('aktif maç durdurulabilir', () => {
      const ctx   = makeCtx();
      const orch  = new LiveMatchOrchestrator(ctx.pipeline);
      const id    = orch.startSimulation('random', 1000);
      const result = orch.stopMatch(id);
      assert.equal(result, true);
      assert.equal(orch.isRunning(id), false);
    });

    it('var olmayan maç false döner', () => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      assert.equal(orch.stopMatch('non-existent'), false);
    });
  });

  describe('listActive', () => {
    it('başlatılan maçlar listelenir', () => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      orch.startSimulation('random', 1000, 'list-test-1');
      orch.startSimulation('random', 1000, 'list-test-2');
      const active = orch.listActive();
      assert.ok(active.length >= 2);
      const ids = active.map(a => a.matchId);
      assert.ok(ids.includes('list-test-1'));
      assert.ok(ids.includes('list-test-2'));
    });
  });

  describe('getMatchState', () => {
    it('aktif maçın durumu sorgulanabilir', () => {
      const ctx   = makeCtx();
      const orch  = new LiveMatchOrchestrator(ctx.pipeline);
      const id    = orch.startSimulation('random', 1000, 'state-test');
      const state = orch.getMatchState(id);
      assert.ok(state !== null);
      assert.equal(state!.matchId, id);
    });

    it('bilinmeyen maç null döner', () => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      assert.equal(orch.getMatchState('unknown-id'), null);
    });
  });

  describe('EventEmitter olayları', () => {
    it('kick_off olayı emit edilir', (_, done) => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      orch.once('match_kick_off', ({ matchState }) => {
        assert.ok(matchState.matchId);
        assert.equal(matchState.status, 'LIVE');
        done();
      });
      orch.startSimulation('random', 10000, 'emit-test');
    });

    it('maç_aborted olayı emit edilir', (_, done) => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);
      orch.once('match_aborted', ({ matchId }) => {
        assert.ok(matchId);
        done();
      });
      const id = orch.startSimulation('random', 10000, 'abort-test');
      setTimeout(() => orch.stopMatch(id), 10);
    });
  });

  describe('Maç tamamlanma (hızlı sim)', () => {
    it('full_time olayı gelir ve maç listeden çıkar', async () => {
      const ctx  = makeCtx();
      const orch = new LiveMatchOrchestrator(ctx.pipeline);

      const fullTimePromise = new Promise<string>(resolve => {
        orch.once('match_full_time', ({ matchState }) => resolve(matchState.matchId));
      });

      const id = orch.startSimulation('final', 10000); // 10000× hızlı → ~9ms
      const finishedId = await fullTimePromise;
      assert.equal(finishedId, id);
      assert.equal(orch.isRunning(id), false);
    });
  });
});
