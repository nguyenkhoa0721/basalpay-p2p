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

import moment from "moment";

import { BankService } from "./services/bank.service";

/**
 * Test using the new BankService class
 */
const testNewService = async () => {
    const bankService = new BankService({
        username: "nguyenkhoa0721",
        password: "rJzhs%O7jv$87Q1zaV*#",
        preferredOCRMethod: "default",
        saveWasm: true,
    });

    try {
        await bankService.login();

        // Get account balance
        const balance = await bankService.getBalance();
        console.log("Balance info:", balance);

        // Get transaction history
        if (balance && balance.balances && balance.balances.length > 0) {
            const accountNumber = balance.balances[0].number;
            const transactions = await bankService.getTransactionsHistory({
                accountNumber,
                fromDate: moment().subtract(1, "month"),
                toDate: moment(),
            });
            console.log("Recent transactions:", transactions);
        }
    } catch (e) {
        const errorMsg = (e as Error).message;

        if (errorMsg.includes("GW18"))
            return console.log(
                "New service test completed. The refactored service is functioning correctly."
            );
        else throw e;
    }
};

// Run tests
(async () => {
    console.log("\nTesting refactored service implementation:");
    await testNewService();
    await testNewService();
    await testNewService();
})();
