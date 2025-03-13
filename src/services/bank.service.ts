/* eslint-disable no-case-declarations */
/*
 * MIT License
 *
 * Copyright (c) 2024 CookieGMVN and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { createHash } from "node:crypto";

import moment from "moment";
import { Client } from "undici";

import { BalanceData, BalanceList, LoginResponseData, TransactionInfo } from "../typings/MBApi";
import { CaptchaResponse } from "../typings/MBLogin";
import { defaultHeaders, FPR, generateDeviceId, getTimeNow } from "../utils/Global";
import wasmEnc from "../utils/LoadWasm";
import OCRModel from "../utils/OCRModel";
import TesseractUtils from "../utils/Tesseract";
import WasmUtils from "../utils/Wasm";

/**
 * Configuration options for BankService
 */
export interface BankServiceConfig {
    /**
     * MB Bank login username (usually your registered phone number)
     */
    username: string;

    /**
     * MB Bank login password
     */
    password: string;

    /**
     * OCR method for captcha recognition
     * - "default": Uses the pre-trained OCR model (recommended)
     * - "tesseract": Uses Tesseract OCR engine
     * - "custom": Uses the custom OCR function provided
     */
    preferredOCRMethod?: "default" | "tesseract" | "custom";

    /**
     * Custom OCR function (required if preferredOCRMethod is "custom")
     */
    customOCRFunction?: (image: Buffer) => Promise<string>;

    /**
     * Whether to save the WASM file to disk (for caching)
     */
    saveWasm?: boolean;
}

/**
 * BankService provides integration with MB Bank's API for authentication,
 * account balance queries, and transaction history.
 *
 * @example
 * ```typescript
 * // Initialize the bank service
 * const bankService = new BankService({
 *   username: '0123456789',   // Your MB Bank phone number
 *   password: 'your_password' // Your MB Bank password
 * });
 *
 * // Login and get account balance
 * async function checkBalance() {
 *   await bankService.login();
 *   const balance = await bankService.getBalance();
 *   console.log('Total balance:', balance.totalBalance);
 *   console.log('Accounts:', balance.balances);
 * }
 *
 * checkBalance().catch(console.error);
 * ```
 */
export class BankService {
    /**
     * MB Bank account username (usually phone number).
     * @readonly
     */
    public readonly username: string;

    /**
     * MB Bank account password.
     * @readonly
     */
    public readonly password: string;

    /**
     * Session identifier returned by MB Bank's API after successful authentication.
     * Used to validate subsequent requests.
     */
    public sessionId: string | null | undefined;

    /**
     * Device identifier used for authentication with MB Bank API.
     * This is automatically generated for each session.
     */
    public deviceId: string = generateDeviceId();

    /**
     * HTTP client for making requests to MB Bank's API.
     */
    public client = new Client("https://online.mbbank.com.vn");

    /**
     * WASM binary data downloaded from MB Bank.
     * Used for request encryption.
     * @private
     */
    private wasmData!: Buffer;

    /**
     * Custom OCR function for captcha recognition.
     * Allows implementing your own captcha recognition logic.
     * @private
     */
    private customOCRFunction?: (image: Buffer) => Promise<string>;

    /**
     * The OCR method to use for captcha recognition.
     * @private
     * @default "default"
     */
    private preferredOCRMethod: "default" | "tesseract" | "custom" = "default";

    /**
     * Whether to save the WASM file to disk.
     * Useful for debugging or caching purposes.
     * @private
     * @default false
     */
    private saveWasm: boolean = false;

    /**
     * Creates a new BankService instance.
     *
     * @param {BankServiceConfig} config - Configuration options
     * @throws {Error} If username or password is not provided
     */
    public constructor(config: BankServiceConfig) {
        if (!config.username || !config.password) {
            throw new Error("You must define at least a MB account to use with this library!");
        }

        this.username = config.username;
        this.password = config.password;

        if (config.preferredOCRMethod) this.preferredOCRMethod = config.preferredOCRMethod;
        if (config.customOCRFunction) this.customOCRFunction = config.customOCRFunction;
        if (config.saveWasm) this.saveWasm = config.saveWasm;
    }

    /**
     * Processes captcha image according to the configured OCR method.
     *
     * @private
     * @param {Buffer} image - Captcha image buffer
     * @returns {Promise<string|null>} Recognized captcha text or null if recognition failed
     */
    private async recognizeCaptcha(image: Buffer): Promise<string | null> {
        switch (this.preferredOCRMethod) {
            case "default":
                const model = new OCRModel();
                await model.loadModel();

                const modelPredictedCaptcha = await model.predict(image);

                if (modelPredictedCaptcha.length !== 6) return null;
                return modelPredictedCaptcha;
            case "tesseract":
                return await TesseractUtils.recognizeText(image);
            case "custom":
                if (!this.customOCRFunction) return null;

                const customPredictedCaptcha = await this.customOCRFunction(image);

                if (customPredictedCaptcha.length !== 6) return null;
                return customPredictedCaptcha;
        }
    }

    /**
     * Authenticates with MB Bank API by solving captcha and sending login credentials.
     * Sets the session ID upon successful login.
     *
     * @returns {Promise<LoginResponseData>} Login response from the API
     * @throws {Error} If login fails with specific error code and message
     */
    public async login(): Promise<LoginResponseData> {
        // Request ID/Ref ID for MB
        const rId = getTimeNow();

        const headers = { ...defaultHeaders };
        headers["X-Request-Id"] = rId;

        const captchaReq = await this.client.request({
            method: "POST",
            path: "/api/retail-web-internetbankingms/getCaptchaImage",
            headers,
            body: JSON.stringify({
                sessionId: "",
                refNo: rId,
                deviceIdCommon: this.deviceId,
            }),
        });

        const captchaRes: CaptchaResponse = (await captchaReq.body.json()) as CaptchaResponse;
        let captchaBuffer = Buffer.from(captchaRes.imageString, "base64");

        const captchaContent = await this.recognizeCaptcha(captchaBuffer);

        if (captchaContent === null) return this.login();

        // Load WASM if not already loaded
        if (!this.wasmData) {
            this.wasmData = await WasmUtils.loadWasm(this.saveWasm ? "main.wasm" : undefined);
        }

        // Create request data
        const requestData = {
            userId: this.username,
            password: createHash("md5").update(this.password).digest("hex"),
            captcha: captchaContent,
            ibAuthen2faString: FPR,
            sessionId: null,
            refNo: getTimeNow(),
            deviceIdCommon: this.deviceId,
        };

        const loginReq = await this.client.request({
            method: "POST",
            path: "/api/retail_web/internetbanking/v2.0/doLogin",
            headers: defaultHeaders,
            body: JSON.stringify({
                dataEnc: await wasmEnc(this.wasmData, requestData, "0"),
            }),
        });

        const loginRes = (await loginReq.body.json()) as any;

        if (!loginRes.result) {
            throw new Error("Login failed: Unknown data");
        }

        if (loginRes.result.ok) {
            this.sessionId = loginRes.sessionId;
            return loginRes;
        } else if (loginRes.result.responseCode === "GW283") {
            // Retry if captcha validation failed
            return this.login();
        } else {
            const e = new Error(
                "Login failed: (" + loginRes.result.responseCode + "): " + loginRes.result.message
            ) as any;
            e.code = loginRes.result.responseCode;
            throw e;
        }
    }

    /**
     * Generates a reference ID required by MB Bank API.
     * The format is "{username}-{timestamp}".
     *
     * @private
     * @returns {string} Reference ID for API requests
     */
    private getRefNo(): string {
        return `${this.username}-${getTimeNow()}`;
    }

    /**
     * Makes an authenticated request to MB Bank API.
     * Handles session expiration by automatically re-logging in.
     *
     * @private
     * @param {Object} data - Request parameters
     * @param {string} data.path - API endpoint path
     * @param {Object} [data.json] - Request body data
     * @param {Object} [data.headers] - Additional request headers
     * @returns {Promise<any>} API response
     * @throws {Error} If the request fails with error code and message
     */
    private async mbRequest(data: { path: string; json?: object; headers?: object }): Promise<any> {
        if (!this.sessionId) {
            await this.login();
        }

        const rId = this.getRefNo();

        const headers = { ...defaultHeaders } as any;
        headers["X-Request-Id"] = rId;
        headers["Deviceid"] = this.deviceId;
        headers["Refno"] = rId;

        const defaultBody = {
            sessionId: this.sessionId,
            refNo: rId,
            deviceIdCommon: this.deviceId,
        };
        const body = Object.assign({}, defaultBody, data.json);

        const httpReq = await this.client.request({
            method: "POST",
            path: data.path,
            headers,
            body: JSON.stringify(body),
        });

        const httpRes = (await httpReq.body.json()) as any;

        if (!httpRes || !httpRes.result) {
            return false;
        } else if (httpRes.result.ok == true) {
            return httpRes;
        } else if (httpRes.result.responseCode === "GW200") {
            // Session expired, login again
            await this.login();
            return this.mbRequest(data);
        } else {
            throw new Error(
                "Request failed (" + httpRes.result.responseCode + "): " + httpRes.result.message
            );
        }
    }

    /**
     * Retrieves account balance information for all accounts.
     *
     * @returns {Promise<BalanceList|undefined>} Account balance data or undefined if request fails
     */
    public async getBalance(): Promise<BalanceList | undefined> {
        const balanceData = await this.mbRequest({ path: "/api/retail-web-accountms/getBalance" });

        if (!balanceData) return;

        const balance: BalanceList = {
            totalBalance: balanceData.totalBalanceEquivalent,
            currencyEquivalent: balanceData.currencyEquivalent,
            balances: [],
        };

        balanceData.acct_list.forEach((acctInfo: unknown) => {
            const acct = acctInfo as any;

            const balanceData: BalanceData = {
                number: acct.acctNo,
                name: acct.acctNm,
                currency: acct.ccyCd,
                balance: acct.currentBalance,
            };

            balance.balances?.push(balanceData);
        });

        balanceData.internationalAcctList.forEach((acctInfo: unknown) => {
            const acct = acctInfo as any;

            const balanceData: BalanceData = {
                number: acct.acctNo,
                name: acct.acctNm,
                currency: acct.ccyCd,
                balance: acct.currentBalance,
            };

            balance.balances?.push(balanceData);
        });

        return balance;
    }

    /**
     * Retrieves transaction history for a specific account within a date range.
     *
     * @param {Object} data - Request parameters
     * @param {string} data.accountNumber - MB Bank account number to query
     * @param {moment.Moment} data.fromDate - Start date
     * @param {moment.Moment} data.toDate - End date
     * @returns {Promise<TransactionInfo[]|undefined>} Array of transaction details or undefined if request fails
     * @throws {Error} If date range exceeds 90 days or date format is invalid
     */
    public async getTransactionsHistory(data: {
        accountNumber: string;
        fromDate: moment.Moment;
        toDate: moment.Moment;
    }): Promise<TransactionInfo[] | undefined> {
        // Validate date ranges
        if (moment().diff(data.fromDate, "days") > 90 || moment().diff(data.toDate, "days") > 90) {
            throw new Error(
                "Date formatting error: Max transaction history must be shorter than 90 days!"
            );
        }
        if (data.fromDate.diff(data.toDate, "days") > 90) {
            throw new Error(
                "Date formatting error: Max transaction history must be shorter than 90 days!"
            );
        }

        const body = {
            accountNo: data.accountNumber,
            fromDate: data.fromDate.format("DD/MM/YYYY"),
            toDate: data.toDate.format("DD/MM/YYYY"),
        };

        const historyData = await this.mbRequest({
            path: "/api/retail-transactionms/transactionms/get-account-transaction-history",
            json: body,
        });

        if (!historyData || !historyData.transactionHistoryList) return;

        const transactionHistories: TransactionInfo[] = [];

        historyData.transactionHistoryList.forEach((transactionRaw: unknown) => {
            const transaction = transactionRaw as any;

            const transactionData: TransactionInfo = {
                postDate: transaction.postingDate,
                transactionDate: transaction.transactionDate,
                accountNumber: transaction.accountNo,
                creditAmount: transaction.creditAmount,
                debitAmount: transaction.debitAmount,
                transactionCurrency: transaction.currency,
                transactionDesc: transaction.description,
                balanceAvailable: transaction.availableBalance,
                refNo: transaction.refNo,
                toAccountName: transaction.benAccountName,
                toBank: transaction.bankName,
                toAccountNumber: transaction.benAccountNo,
                type: transaction.transactionType,
            };

            transactionHistories.push(transactionData);
        });

        return transactionHistories;
    }
}
