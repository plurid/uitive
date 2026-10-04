// Zod compiles its fastest parsers with `new Function`, probing for it as it builds the first object
// schema. A strict Content-Security-Policy, such as the one uitive.dev serves the demo with, reports
// that probe as a violation even though Zod catches it. The demo's schemas are small, so it parses
// them without the compiler. Imported first, so this runs before any schema exists.
import { z } from 'zod';

z.config({ jitless: true });
