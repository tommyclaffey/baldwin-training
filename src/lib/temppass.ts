// Temporary passwords (Nov 24; Figma 09 · Idea Board → 49, 1002:194). "Make One for Me" makes them here, with
// the browser's own secure random numbers; the server only ever gets the value to hash (server/temppass.mjs).
// No imports, so the tests can load it as it is.

// Plain, easy-to-say words (two of them + 4 numbers: about 27 bits, for something that works once, expires within days and
// sits behind the sign-in limits). Kitchen and outdoors words, nothing that reads badly next to another.
const WORDS = ('almond amber anise apple apricot aspen basil bay beacon bean berry birch biscuit bramble brook butter cabin cactus canyon caper '
  + 'caramel cedar celery cherry chestnut cider cinnamon citrus clover cobalt cocoa comet copper coral cove cream crimson crisp cumin '
  + 'daisy delta dune ember fennel fern fig flint frost garden garnet ginger granite grape gravel grove harbor hazel heather hickory honey '
  + 'indigo island ivory jasmine juniper kale kettle lagoon lantern lark laurel lemon lilac lime linen lotus mango maple marble marigold '
  + 'meadow melon mesa mint mocha moss nectar nutmeg oak oat olive onyx orange orchard otter paprika parsley pasta peach pear pebble pecan '
  + 'pepper pine plum poppy prairie pumpkin quince radish rain raisin raven reef river robin rose rosemary saffron sage salt sesame shore '
  + 'sierra slate sorrel spruce summit sunny thyme tide toast topaz tulip valley vanilla velvet walnut willow winter yarrow zest').split(' ');

const rand = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };

/** "quince-harbor-4827": two words and four numbers. Always 10+ characters. */
export function makeTempPassword() {
  const a = WORDS[rand(WORDS.length)];
  let b = WORDS[rand(WORDS.length)];
  while (b === a) b = WORDS[rand(WORDS.length)];
  return `${a}-${b}-${String(1000 + rand(9000))}`;
}

/** The lengths an admin can pick. */
export const TEMP_DAYS = [1, 3, 7, 14] as const;
export const DEFAULT_TEMP_DAYS = 7;
/** "Nov 30" */
export const dayLabel = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const untilFor = (days: number) => dayLabel(new Date(Date.now() + days * 864e5));
