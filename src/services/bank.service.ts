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
import { Config } from "../config";

export interface BankServiceConfig {
    username: string;
    password: string;
    preferredOCRMethod?: "default" | "tesseract" | "custom";
    customOCRFunction?: (image: Buffer) => Promise<string>;
    saveWasm?: boolean;
}

export class BankService {
    public readonly username: string;
    public readonly password: string;
    public sessionId: string | null | undefined;
    public deviceId: string = generateDeviceId();
    public client = new Client("https://online.mbbank.com.vn");
    private wasmData!: Buffer;
    private customOCRFunction?: (image: Buffer) => Promise<string>;
    private preferredOCRMethod: "default" | "tesseract" | "custom" = "default";
    private saveWasm: boolean = false;

    public constructor() {
        if (!Config.bank.username || !Config.bank.password) {
            throw new Error("You must define at least a MB account to use with this library!");
        }

        this.username = Config.bank.username;
        this.password = Config.bank.password;
        this.preferredOCRMethod = "default";
        this.saveWasm = true;
    }

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

    public async login(): Promise<LoginResponseData> {
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

        if (!this.wasmData) {
            this.wasmData = await WasmUtils.loadWasm(this.saveWasm ? "main.wasm" : undefined);
        }

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
            return this.login();
        } else {
            const e = new Error(
                "Login failed: (" + loginRes.result.responseCode + "): " + loginRes.result.message
            ) as any;
            e.code = loginRes.result.responseCode;
            throw e;
        }
    }

    private getRefNo(): string {
        return `${this.username}-${getTimeNow()}`;
    }

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
            await this.login();
            return this.mbRequest(data);
        } else {
            throw new Error(
                "Request failed (" + httpRes.result.responseCode + "): " + httpRes.result.message
            );
        }
    }

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

    public async getTransactionsHistory(data: {
        accountNumber: string;
        fromDate: moment.Moment;
        toDate: moment.Moment;
    }): Promise<TransactionInfo[] | undefined> {
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
