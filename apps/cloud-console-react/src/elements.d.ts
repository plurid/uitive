import type { Persona } from '@plurid/uitive-core';
import type { ClientLike } from '@plurid/uitive-dom';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type Element<Properties> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Properties;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'uitive-banner': Element<{ client?: ClientLike }>;
      'uitive-your-interface': Element<{ client?: ClientLike }>;
      'uitive-debug': Element<{ client?: ClientLike; personas?: readonly Persona[] }>;
    }
  }
}
