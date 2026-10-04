import type { SerpApiClient } from "../services/serpapi/client";
import type {
  NormalizedHotel,
  NormalizedHotelsResponse,
} from "../services/serpapi/types";
import type { TripRequirements } from "../trips/requirements";

/**
 * Hotel research: live stay candidates through the existing gateway.
 * No HTTP here — the injected SerpApiClient owns transport.
 * Returns normalized candidates only; selection happens in the builder.
 */

export interface HotelResearch {
  query: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  hotels: NormalizedHotel[];
}

export async function researchHotels(
  client: SerpApiClient,
  requirements: TripRequirements,
  stayWindow: { checkIn: string; checkOut: string; verified: boolean },
  currency: string,
): Promise<HotelResearch> {
  const query = `hotels in ${requirements.destination}`;
  const data: NormalizedHotelsResponse = await client.searchHotels({
    query,
    checkIn: stayWindow.checkIn,
    checkOut: stayWindow.checkOut,
    adults: requirements.adults,
    children: requirements.children,
    childrenAges: requirements.childrenAges,
    currency,
  });
  return {
    query,
    checkIn: stayWindow.checkIn,
    checkOut: stayWindow.checkOut,
    currency,
    hotels: data.results,
  };
}
