/** A provider acknowledgement can be lost after acceptance. Never infer rejection. */
export class ChannelDeliveryError extends Error {
    acceptance;
    constructor(acceptance) {
        super(acceptance === 'rejected' ? 'Channel delivery was rejected.' : 'Channel delivery acknowledgement is uncertain.');
        this.acceptance = acceptance;
        this.name = 'ChannelDeliveryError';
    }
}
export class UncertainChannelDeliveryError extends Error {
    constructor() { super('Open the assistant in ThatCampus to read this reply. Delivery was not retried because its acknowledgement is uncertain.'); this.name = 'UncertainChannelDeliveryError'; }
}
//# sourceMappingURL=provider.js.map