// 纯逻辑单测：验证审核通过后的库存结存与流水差额计算正确（不依赖数据库）
import assert from 'node:assert/strict';
import { computeStock } from '../src/service/inventory.js';

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

console.log('inventory.computeStock:');

check('入库：空库存 +100 -> 100', () => {
  const c = computeStock(null, { qty: 100, amount: 500 }, 'inbound');
  assert.equal(c.newQty, 100);
  assert.equal(c.newAmt, 500);
  assert.equal(c.changeQty, 100);
});

check('入库：已有 50 +30 -> 80', () => {
  const c = computeStock({ qty: 50, amount: 250 }, { qty: 30, amount: 150 }, 'inbound');
  assert.equal(c.newQty, 80);
  assert.equal(c.newAmt, 400);
});

check('出库：80 -30 -> 50，差额为负', () => {
  const c = computeStock({ qty: 80, amount: 400 }, { qty: 30, amount: 150 }, 'outbound');
  assert.equal(c.newQty, 50);
  assert.equal(c.newAmt, 250);
  assert.equal(c.changeQty, -30);
});

check('出库：amount 可由 qty*unit_price 推导', () => {
  const c = computeStock({ qty: 80, amount: 400 }, { qty: 10, unit_price: 5 }, 'outbound');
  assert.equal(c.changeAmount, -50);
  assert.equal(c.newAmt, 350);
});

check('出库：库存不足会得到负数（审核时应拦截）', () => {
  const c = computeStock({ qty: 5, amount: 25 }, { qty: 10, amount: 50 }, 'outbound');
  assert.equal(c.newQty, -5); // 业务层需校验 >=0
});

console.log(`\n全部通过：${pass} 个用例`);
