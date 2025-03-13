import axios from "axios";

/**
 * Fetches current Binance P2P rate for USDT/VND
 *
 * @returns {Promise<number|null>} Average P2P rate or null on error
 */
export async function getBinanceP2PRate(): Promise<number | null> {
    try {
        // This uses Binance P2P API to get current rates
        const response = await axios.post(
            "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
            {
                fiat: "VND",
                page: 1,
                rows: 10,
                tradeType: "BUY",
                asset: "USDT",
                countries: [],
                proMerchantAds: false,
                payTypes: [],
            },
            {
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        if (response.data && response.data.data && Array.isArray(response.data.data)) {
            // Calculate average from the first 5 advertisements
            const ads = response.data.data.slice(0, 5);

            if (ads.length === 0) {
                console.error("No P2P advertisements found");
                return null;
            }

            const pricesSum = ads.reduce(
                (sum: number, ad: { adv: { price: string } }) => sum + parseFloat(ad.adv.price),
                0
            );
            const averagePrice = pricesSum / ads.length;

            console.log(
                `Fetched Binance P2P rate: ${averagePrice} VND/USDT (based on ${ads.length} ads)`
            );

            return averagePrice;
        }

        console.error("Invalid response from Binance P2P API");
        return null;
    } catch (error) {
        console.error("Error fetching Binance P2P rate:", error);

        // Return a fallback rate if API fails
        return 25000; // Example fallback rate
    }
}

/**
 * Converts USD to VND using Binance P2P rate + markup
 *
 * @param {number} usdAmount Amount in USD/USDT
 * @param {number} markup Markup percentage (e.g., 2 for 2%)
 * @returns {Promise<number|null>} Amount in VND or null on error
 */
export async function convertUsdToVnd(
    usdAmount: number,
    markup: number = 2
): Promise<number | null> {
    try {
        const rate = await getBinanceP2PRate();

        if (!rate) {
            return null;
        }

        // Apply markup
        const adjustedRate = rate * (1 + markup / 100);

        // Calculate and round to nearest 1000 VND
        const vndAmount = Math.ceil((usdAmount * adjustedRate) / 1000) * 1000;

        return vndAmount;
    } catch (error) {
        console.error("Error converting USD to VND:", error);
        return null;
    }
}
