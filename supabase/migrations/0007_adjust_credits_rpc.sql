CREATE OR REPLACE FUNCTION public.adjust_credits(p_user_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_balance numeric;
BEGIN
  UPDATE public.profiles
  SET credits_balance = credits_balance + p_delta
  WHERE id = p_user_id
    AND credits_balance + p_delta >= 0
  RETURNING credits_balance INTO next_balance;

  IF next_balance IS NULL THEN
    RAISE EXCEPTION 'Not enough credits';
  END IF;

  RETURN next_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_credits(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_credits(uuid, numeric) TO service_role;
