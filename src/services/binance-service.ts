import axios from "axios";

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

        if (response.data && response.data.data && Array.isArray(response.data.data)) {
            const ads = response.data.data.slice(0, 10);

            if (ads.length === 0) {
                console.error("No P2P advertisements found");
                return null;
            }

            const price = ads.reduce(
                (max: number, ad: { adv: { price: string } }) =>
                    Math.max(parseFloat(ad.adv.price), max),
                0
            );

            console.log(`Fetched Binance P2P rate: ${price} VND/USDT (based on ${ads.length} ads)`);

            return price;
        }

        console.error("Invalid response from Binance P2P API");
        return null;
    } catch (error) {
        console.error("Error fetching Binance P2P rate:", error);
        return 25000;
    }
}

export async function convertUsdToVnd(
    usdAmount: number,
    markup: number = 2
): Promise<number | null> {
    try {
        const rate = await getBinanceP2PRate();

        if (!rate) {
            return null;
        }

        const adjustedRate = rate * (1 + markup / 100);
        const vndAmount = Math.ceil((usdAmount * adjustedRate) / 1000) * 1000;

        return vndAmount;
    } catch (error) {
        console.error("Error converting USD to VND:", error);
        return null;
    }
}
