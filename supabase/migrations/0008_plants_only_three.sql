-- 目前只供應三種植栽：翡翠、觀音蓮、小毛氈苔；其餘下架（保留資料，舊訂單仍可參照）
update planet.plants set active = (id in (1, 3, 5));
