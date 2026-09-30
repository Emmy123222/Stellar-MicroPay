import { PaymentService } from '../payment.service';
import { HttpException } from '@nestjs/common';

describe('Payment Service Dust-Payment Validation (#1209)', () => {
  let paymentService: PaymentService;

  beforeEach(() => {
    paymentService = new PaymentService();
  });

  it('rejects payments with amount less than 0.0001 XLM with 400 Bad Request', async () => {
    const payload = { amount: 0.00005, recipient: 'GC123...' };

    await expect(paymentService.submitPayment(payload)).rejects.toThrow(HttpException);

    try {
      await paymentService.submitPayment(payload);
    } catch (error: any) {
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({
        message: 'Amount too small — minimum payment is 0.0001 XLM',
      });
    }
  });

  it('accepts payments with amount equal to or greater than 0.0001 XLM', async () => {
    const payloadValid = { amount: 0.0001, recipient: 'GC123...' };
    const result = await paymentService.submitPayment(payloadValid);

    expect(result.success).toBe(true);
  });
});