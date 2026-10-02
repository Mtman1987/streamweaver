import assert from 'node:assert/strict';
import test from 'node:test';
import { inferRaffleTicketQuantity } from '../src/services/raffle-system';

test('raffle ticket titles infer ticket quantities without using Twitch point cost', () => {
  assert.equal(inferRaffleTicketQuantity('Raffle Ticket'), 1);
  assert.equal(inferRaffleTicketQuantity('5 Raffle Tickets'), 5);
  assert.equal(inferRaffleTicketQuantity('Raffle Tickets x10'), 10);
  assert.equal(inferRaffleTicketQuantity('Dance Party'), null);
});
