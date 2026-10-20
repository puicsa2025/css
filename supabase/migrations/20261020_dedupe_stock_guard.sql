-- Keep only the original stock guard; prevent duplicate trigger execution.
drop trigger if exists css_stock_guard on public.css_asset_loans;
drop function if exists css_private.check_asset_stock();