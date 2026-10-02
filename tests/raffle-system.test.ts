import assert from 'node:assert/strict';
import test from 'node:test';
import { inferRaffleId, inferRaffleTicketQuantity } from '../src/services/raffle-system';

test('raffle ticket titles infer ticket quantities without using Twitch point cost', () => {
  assert.equal(inferRaffleTicketQuantity('Raffle Ticket'), 1);
  assert.equal(inferRaffleTicketQuantity('5 Raffle Tickets'), 5);
  assert.equal(inferRaffleTicketQuantity('Raffle Tickets x10'), 10);
  assert.equal(inferRaffleTicketQuantity('Dance Party'), null);
});


test('the two giveaway redeems resolve to separate drawings, with point costs checked', () => {
  assert.equal(inferRaffleId('Give away! (Merch)(1000c)', 1000), 'merch');
  assert.equal(inferRaffleId('Give away $25(1500c)', 1500), 'giftcard');
  assert.equal(inferRaffleId('Give away! (Merch)(1000c)', 1500), null);
  assert.equal(inferRaffleId('Give away $25(1500c)', 1000), null);
  assert.equal(inferRaffleId('Dance Party', 1000), null);
  assert.equal(inferRaffleId('Raffle Tickets x10'), 'general');
});
