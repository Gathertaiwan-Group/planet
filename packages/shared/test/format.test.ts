import { describe, expect, it } from "vitest";
import { ecpayCheckMacValue } from "../src/ecpay";
import { eventDateParts, nt, seatText } from "../src/index";

describe("format", () => {
  it("nt 千分位", () => {
    expect(nt(1280)).toBe("NT$ 1,280");
    expect(nt(280)).toBe("NT$ 280");
  });
  it("活動日期以台北時間顯示", () => {
    const p = eventDateParts("2026-12-06T14:00:00+08:00");
    expect(p).toMatchObject({ m: 12, mon: "DEC", day: "06", dow: "週日", time: "14:00", dateText: "12/06 週日" });
  });
  it("座位文案", () => {
    expect(seatText(4).text).toBe("只剩 4 位！");
    expect(seatText(5).text).toBe("剩 5 位");
    expect(seatText(0).text).toBe("已額滿");
  });
});

describe("ECPay CheckMacValue", () => {
  it("綠界文件範例", () => {
    const params = {
      ChoosePayment: "ALL",
      EncryptType: 1,
      ItemName: "Apple iphone 15",
      MerchantID: "3002607",
      MerchantTradeDate: "2023/03/12 15:30:23",
      MerchantTradeNo: "ecpay20230312153023",
      PaymentType: "aio",
      ReturnURL: "https://www.ecpay.com.tw/receive.php",
      TotalAmount: 30000,
      TradeDesc: "促銷方案",
    };
    expect(ecpayCheckMacValue(params, "pwFHCqoQZGmho4w6", "EkRm7iFT261dpevs")).toBe(
      "6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840",
    );
  });
});
