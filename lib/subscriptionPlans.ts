import type { CreatorTier, ParticipantTier } from '@/lib/subscriptionEntitlements';
import { formatPublicCreatorPrice } from '@/lib/gamemasterCustomPricing';

export type SubscriptionPlanKind = 'player' | 'creator';

export type SubscriptionPlanItem = {
  id: string;
  kind: SubscriptionPlanKind;
  title: string;
  price: string;
  summary: string;
  features: string[];
  participantTier?: ParticipantTier;
  creatorTier?: CreatorTier;
  cta: 'coming_soon' | 'contact';
};

export const PARTICIPANT_PLAN_PRICES: Record<ParticipantTier, string> = {
  user: 'Free',
  user_plus: '€0.99/mo',
  user_premium: '€1.99/mo',
};

export const CREATOR_PLAN_PRICES: Record<Exclude<CreatorTier, 'gamemaster'>, string> = {
  creator: formatPublicCreatorPrice('creator'),
  creator_plus: formatPublicCreatorPrice('creator_plus'),
  creator_pro: formatPublicCreatorPrice('creator_pro'),
};

/** Public self-serve plans (Gamemaster is custom / quote-only). */
export const SUBSCRIPTION_PLAN_CATALOG: SubscriptionPlanItem[] = [
  {
    id: 'user',
    kind: 'player',
    title: 'User',
    price: PARTICIPANT_PLAN_PRICES.user,
    summary: 'Play in a couple of live competitions.',
    features: ['2 concurrent competition joins', 'Occasional in-app ads'],
    participantTier: 'user',
    cta: 'coming_soon',
  },
  {
    id: 'user_plus',
    kind: 'player',
    title: 'User Plus',
    price: PARTICIPANT_PLAN_PRICES.user_plus,
    summary: 'More leagues, no ads.',
    features: ['5 concurrent competition joins', 'No in-app ads'],
    participantTier: 'user_plus',
    cta: 'coming_soon',
  },
  {
    id: 'user_premium',
    kind: 'player',
    title: 'User Premium',
    price: PARTICIPANT_PLAN_PRICES.user_premium,
    summary: 'Unlimited player access.',
    features: ['Unlimited competition joins', 'No in-app ads'],
    participantTier: 'user_premium',
    cta: 'coming_soon',
  },
  {
    id: 'creator',
    kind: 'creator',
    title: 'Creator',
    price: CREATOR_PLAN_PRICES.creator,
    summary: 'Run your own competitions in one sport.',
    features: [
      '2 active competitions',
      'Up to 30 players per competition',
      '50 players across live comps',
      'One sport at a time',
      'Includes User Plus player access',
    ],
    creatorTier: 'creator',
    cta: 'coming_soon',
  },
  {
    id: 'creator_plus',
    kind: 'creator',
    title: 'Creator Plus',
    price: CREATOR_PLAN_PRICES.creator_plus,
    summary: 'Larger fields in one sport.',
    features: [
      '5 active competitions',
      'Up to 50 players per competition',
      '150 players across live comps',
      'One sport at a time',
      'Includes User Plus player access',
    ],
    creatorTier: 'creator_plus',
    cta: 'coming_soon',
  },
  {
    id: 'creator_pro',
    kind: 'creator',
    title: 'Creator Pro',
    price: CREATOR_PLAN_PRICES.creator_pro,
    summary: 'All sports, bigger capacity.',
    features: [
      '10 active competitions',
      'Up to 75 players per competition',
      '350 players across live comps',
      'Football, racing & more',
      'Includes User Premium player access',
    ],
    creatorTier: 'creator_pro',
    cta: 'coming_soon',
  },
];

export const GAMEMASTER_CONTACT_NOTE =
  'Are you a club or syndicate? Get in touch about our Gamemaster subscription — perfect for charitable events or large competitions.';
