/**
 * @deprecated Removed. Use deploy/lab-shield-http (`npm run lab:shield`) + HttpShieldConnector.
 * This file remains only so old imports fail loudly at build/test time.
 */
export class MockShieldConnector {
  constructor() {
    throw new Error(
      'MockShieldConnector removed — run `npm run lab:shield` and use CLASSROOM_DESK_SHIELD=http',
    );
  }
}
