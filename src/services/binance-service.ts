import axios from "axios";

// Default fallback rate if API call fails
const FALLBACK_RATE = 25000;

/**
 * Get the latest Binance P2P rate for USDT/VND
 * Returns the highest available rate from the first 10 ads
 */
export async function getBinanceP2PRate(): Promise<number | null> {
    try {
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

        // Validate the response structure
        if (!response.data?.data || !Array.isArray(response.data.data)) {
            console.error("Invalid response from Binance P2P API");
            return FALLBACK_RATE;
        }

        const ads = response.data.data.slice(0, 10);

        if (ads.length === 0) {
            console.error("No P2P advertisements found");
            return FALLBACK_RATE;
        }

        // Find the highest price available
        const price = ads.reduce(
            (max: number, ad: { adv: { price: string } }) =>
                Math.max(parseFloat(ad.adv.price), max),
            0
        );

        if (price <= 0) {
            console.error("Invalid price value from Binance P2P API");
            return FALLBACK_RATE;
        }

        console.log(`Fetched Binance P2P rate: ${price} VND/USDT (based on ${ads.length} ads)`);
        return price;
    } catch (error) {
        console.error("Error fetching Binance P2P rate:", error);
        return FALLBACK_RATE;
    }
}

/**
 * Convert USD amount to VND with optional markup
 * Returns amount rounded to nearest 1000 VND
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

        // Round to nearest 1000 VND
        const vndAmount = Math.ceil((usdAmount * adjustedRate) / 1000) * 1000;

        return vndAmount;
    } catch (error) {
        console.error("Error converting USD to VND:", error);
        return null;
    }
}
