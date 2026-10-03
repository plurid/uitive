import { z } from 'zod';

// Extension pages forbid evaluating strings, which zod would otherwise probe for.
z.config({ jitless: true });
