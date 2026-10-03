import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach,vi } from 'vitest';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

// jsdom has no native dialog implementation; real dialog focus is checked in Chromium.
HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
