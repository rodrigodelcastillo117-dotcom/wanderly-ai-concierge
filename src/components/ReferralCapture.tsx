import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { captureReferral } from "@/lib/referral";

export function ReferralCapture() {
  const { search } = useLocation();
  useEffect(() => { captureReferral(search); }, [search]);
  return null;
}
