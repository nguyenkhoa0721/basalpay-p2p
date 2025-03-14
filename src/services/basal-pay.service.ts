import axios from "axios";
import { Config } from "../config";

// Response interfaces
interface BalanceResponse {
    success: boolean;
    data: {
        balance: string;
        currencyId: string;
    };
}

interface TransferResponse {
    success: boolean;
    data: {
        id: string;
        type: string;
        fromUserId: string;
        toUserId: string;
        currencyId: string;
        amount: string;
        status: string;
        memo: string;
        createdAt: string;
        updatedAt: string;
    };
}

interface FeeResponse {
    success: boolean;
    data: {
        disbursement_system: {
            role: string;
            amount: string;
        };
        platform_fee: {
            role: string;
            amount: string;
        };
    };
}

// Request interfaces
interface WalletTransferRequest {
    toUserId: string;
    amount: string;
    currencyId: string;
    memo: string;
    fundPassword: string;
}

interface FeeRequest {
    amount: string;
    transactionType: string;
}

export class BasalPayService {
    private baseUrl: string;
    private accessToken: string;

    constructor() {
        this.baseUrl = Config.basalPay.apiUrl;
        this.accessToken = Config.basalPay.accessToken;
    }

    private getHeaders() {
        return {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
        };
    }

    /**
     * Get a Basal Pay user by email
     */
    async getUserByEmail(email: string): Promise<string | null> {
        try {
            const response = await axios.get(`${this.baseUrl}/user/email/${email}`, {
                headers: this.getHeaders(),
            });

            if (!response.data.success || !response.data.data || response.data.data.length === 0) {
                return null;
            }

            return response.data.data.id;
        } catch (error) {
            console.error("Error fetching user by email:", error);
            return null;
        }
    }

    /**
     * Get the USDT balance for the authenticated user
     */
    async getUsdtBalance(): Promise<string> {
        try {
            const response = await axios.get<BalanceResponse>(
                `${this.baseUrl}/wallet/balance/usdt`,
                { headers: this.getHeaders() }
            );

            if (!response.data.success) {
                throw new Error("Failed to fetch USDT balance");
            }

            return response.data.data.balance;
        } catch (error) {
            console.error("Error getting USDT balance:", error);
            throw error;
        }
    }

    /**
     * Check if there's sufficient USDT balance for a transaction
     */
    async hasSufficientBalance(amount: string): Promise<boolean> {
        try {
            const balance = await this.getUsdtBalance();
            const numBalance = parseFloat(balance);
            const numAmount = parseFloat(amount);

            return !isNaN(numBalance) && !isNaN(numAmount) && numBalance >= numAmount;
        } catch (error) {
            console.error("Error checking USDT balance:", error);
            return false;
        }
    }

    /**
     * Calculate the fee for a transaction
     */
    async calculateFee(amount: string): Promise<{ systemFee: string; platformFee: string }> {
        try {
            const feeRequest: FeeRequest = {
                amount,
                transactionType: "disbursement",
            };

            const response = await axios.post<FeeResponse>(
                `${this.baseUrl}/wallet/fee`,
                feeRequest,
                { headers: this.getHeaders() }
            );

            if (!response.data.success) {
                throw new Error("Failed to calculate fee");
            }

            return {
                systemFee: response.data.data.disbursement_system.amount,
                platformFee: response.data.data.platform_fee.amount,
            };
        } catch (error) {
            console.error("Error calculating fee:", error);
            throw error;
        }
    }

    /**
     * Transfer USDT to another user
     */
    async transferUsdt(transferRequest: WalletTransferRequest): Promise<TransferResponse> {
        try {
            const response = await axios.post<TransferResponse>(
                `${this.baseUrl}/wallet/transfer`,
                transferRequest,
                { headers: this.getHeaders() }
            );

            if (!response.data.success) {
                throw new Error("Failed to transfer USDT");
            }

            return response.data;
        } catch (error) {
            console.error("Error transferring USDT:", error);
            throw error;
        }
    }

    /**
     * Get transaction status by ID
     */
    async getTransactionStatus(transactionId: string): Promise<any> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/wallet/transaction/${transactionId}/status`,
                { headers: this.getHeaders() }
            );

            if (!response.data.success) {
                throw new Error("Failed to get transaction status");
            }

            return response.data.data;
        } catch (error) {
            console.error("Error getting transaction status:", error);
            throw error;
        }
    }
}
