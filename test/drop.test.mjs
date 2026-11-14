// The three-line drop worked out from the dish (Nov 14, Tommy: "auto generated with the main dish component, side and sauce or topper").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoDrop, dropSentence } from '../server/drop.mjs';

const dish = (name, ingredients, extra = {}) => autoDrop({ name, ingredients, ...extra });

test('main, side and sauce from the Food Book ingredients', () => {
  const d = dish('Steak Frites', ['Sliced sirloin', 'Salsa verde', 'Zip sauce', 'Fries']);
  assert.deepEqual([d.main, d.side, d.sauce, d.sauceLabel], ['Sliced sirloin', 'Fries', 'Salsa verde', 'Sauce']);
  assert.equal(d.say, 'Here’s the Steak Frites: sliced sirloin, fries, finished with salsa verde.');
});

test('the cooking method is never a part of the plate; two sides read as one line', () => {
  const d = dish('Espresso Encrusted Filet Mignon', ['Filet mignon', 'Espresso crust', 'Grilled asparagus', 'Mashed potato', 'Caramelized fennel & peppers', 'Zip sauce', 'Chervil']);
  assert.deepEqual([d.main, d.side, d.sauce], ['Filet mignon', 'Grilled asparagus and mashed potato', 'Zip sauce']);
});

test('no sauce: the third tile is the Topper', () => {
  const d = dish('Mushroom Brie Soup', ['Local mushrooms', 'Brie', 'Sourdough croutons']);
  assert.deepEqual([d.main, d.sauce, d.sauceLabel], ['Local mushrooms', 'Sourdough croutons', 'Topper']);
  assert.match(d.say, /topped with sourdough croutons\.$/);
});

test('the main is what the dish is named after, never its sauce', () => {
  assert.equal(dish('Mushroom Toast', ['Toast', 'Whipped goat cheese & mascarpone', 'Local mushrooms', 'Crispy sage', 'Truffle honey']).main, 'Local mushrooms');
  assert.equal(dish('Sunday Sauce', ['Fresh spaghetti', 'Organic tomato sauce', 'Locatelli', 'Basil']).main, 'Fresh spaghetti');
  assert.equal(dish('Tot Oscar', ['Tater tots', 'Hollandaise', 'Butter-roasted crab', 'Caviar', 'Chives']).sauce, 'Hollandaise', '"butter-roasted" isn’t a sauce');
});

test('the build’s components win over the ingredient list when there are 3 or more', () => {
  const d = autoDrop({ name: 'Braised Short Rib', ingredients: ['Beef short rib', 'Red wine braise'], components: [{ name: 'Braised short rib' }, { name: 'Pan gravy' }, { name: 'Spinach' }, { name: 'Carrot ribbon' }] });
  assert.deepEqual([d.main, d.side, d.sauce], ['Braised short rib', 'Spinach and carrot ribbon', 'Pan gravy']);
});

test('nothing to go on: no drop', () => {
  assert.equal(autoDrop({ name: 'Special', ingredients: ['Chef’s choice'] }), null);
  assert.equal(dropSentence('', 'x'), null);
});
