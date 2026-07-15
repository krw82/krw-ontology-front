import "server-only";

import type { Locale } from "@/i18n/config";
import { SITE_NAME } from "./site";

const DEFAULT_BUSINESS_EMAIL = "business@example.com";

function configuredValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export interface BusinessInformation {
  companyName: string;
  businessRegistrationNumber: string;
  ecommerceRegistrationNumber: string;
  email: string;
  privacyOfficer: string;
  representative: string;
  phone: string;
  address: string;
}

export function getBusinessInformation(locale: Locale): BusinessInformation {
  const missing = locale === "ko" ? "정보 입력 필요" : "Configure required";

  return {
    companyName: configuredValue("BUSINESS_NAME") ?? SITE_NAME,
    businessRegistrationNumber:
      configuredValue("BUSINESS_REGISTRATION_NUMBER") ?? missing,
    ecommerceRegistrationNumber:
      configuredValue("BUSINESS_ECOMMERCE_REGISTRATION_NUMBER") ?? missing,
    email: configuredValue("BUSINESS_EMAIL") ?? DEFAULT_BUSINESS_EMAIL,
    privacyOfficer: configuredValue("BUSINESS_PRIVACY_OFFICER") ?? missing,
    representative: configuredValue("BUSINESS_REPRESENTATIVE") ?? missing,
    phone: configuredValue("BUSINESS_PHONE") ?? missing,
    address: configuredValue("BUSINESS_ADDRESS") ?? missing,
  };
}

export const BUSINESS_CONTACT_EMAIL =
  configuredValue("BUSINESS_EMAIL") ?? DEFAULT_BUSINESS_EMAIL;
