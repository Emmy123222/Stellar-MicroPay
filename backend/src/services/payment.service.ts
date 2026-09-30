import { HttpException, HttpStatus } from '@nestjs/common'; // Assuming NestJS based on user profile

const MIN_PAYMENT_XLM = 0.0001; // 1000 stroops (exceeds min fee of ~100 stroops to prevent dust)

export interface PaymentSubmissionDto {
  amount: number;
  recipient: string;
  memo?: string;
}

export class PaymentService {
  async submitPayment(dto: PaymentSubmissionDto): Promise<{ success: boolean; txHash?: string }> {
    // Validate amount before submitting to Horizon
    if (dto.amount < MIN_PAYMENT_XLM) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Amount too small — minimum payment is 0.0001 XLM',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Proceed with Horizon transaction submission...
    return { success: true, txHash: 'mock_tx_hash_abc123' };
  }
}