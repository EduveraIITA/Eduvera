import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Deliberately disconnected until a reviewed SMS provider is configured.
 * Never returns a development OTP or treats provider acceptance as verification. */
@Injectable()
export class AccountPhoneDelivery {
  configured(): boolean { return false; }
  async send(_input: { phone: string; code: string; expiresAt: Date; challengeId: string }): Promise<void> {
    throw new ServiceUnavailableException('SMS verification is not connected yet. Your contact number remains unverified.');
  }
}
