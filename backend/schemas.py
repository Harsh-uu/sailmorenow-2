"""Pydantic request/response schemas."""
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any



class RegisterBody(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    primary_market: str
    account_type: str
    boat_name: Optional[str] = None
    boat_make_model: Optional[str] = None
    company_name: Optional[str] = None
    org_name: Optional[str] = None
    org_category: Optional[str] = None
    org_categories: Optional[List[str]] = None
    referred_by: Optional[str] = None
    newsletter_opt_in: bool = True
    agreed_to_guidelines: bool = False
    company_website: Optional[str] = None
    form_elapsed_ms: Optional[int] = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str



class OnboardingBody(BaseModel):
    account_type: str
    primary_market: str
    markets: List[str] = []
    reasons: List[str] = []
    avatar: Optional[str] = None
    username: Optional[str] = None
    handle: Optional[str] = None
    bio: Optional[str] = None
    newsletter_opt_in: bool = True
    policies_agreed: bool
    org_category: Optional[str] = None


class BoatProUpsert(BaseModel):
    company_name: str
    contact_name: Optional[str] = None
    logo_url: Optional[str] = None
    photo_url: Optional[str] = None
    photos: Optional[List[str]] = None
    short_bio: Optional[str] = None
    website: Optional[str] = None
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    categories: List[str]
    markets: List[str]
    tier: str = "basic"
    certifications: List[str] = []
    licenses: List[str] = []
    insurance: List[str] = []


class AccountTypeSwap(BaseModel):
    account_type: str  # only sailor <-> boat_owner allowed via this endpoint
    boat_name: Optional[str] = None
    boat_make_model: Optional[str] = None


class BoatDetailsUpdate(BaseModel):
    boat_name: Optional[str] = None
    boat_make_model: Optional[str] = None


class ProfileSelfUpdate(BaseModel):
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    company_name: Optional[str] = None
    org_name: Optional[str] = None
    website: Optional[str] = None
    primary_market: Optional[str] = None
    org_category: Optional[str] = None
    org_categories: Optional[List[str]] = None
    bio: Optional[str] = None


class ReviewCreate(BaseModel):
    target_id: str
    rating: int
    comment: Optional[str] = Field(default="", max_length=1000)
    category_ratings: Optional[Dict[str, int]] = None


class OrgReviewCreate(BaseModel):
    rating: int
    comment: Optional[str] = Field(default="", max_length=1000)
    category_ratings: Optional[Dict[str, int]] = None


class OrgListingUpdate(BaseModel):
    org_name: Optional[str] = None
    website: Optional[str] = None
    handle: Optional[str] = None
    bio: Optional[str] = None
    logo_url: Optional[str] = None
    org_categories: Optional[List[str]] = None
    primary_market: Optional[str] = None
    markets: Optional[List[str]] = None
    public_email: Optional[str] = None
    public_phone: Optional[str] = None
    photos: Optional[List[Any]] = None
    logo_original_url: Optional[str] = None
    cover_url: Optional[str] = None
    cover_original_url: Optional[str] = None


class BoatProListingUpdate(BaseModel):
    company_name: Optional[str] = None
    short_bio: Optional[str] = None
    website: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    categories: Optional[List[str]] = None
    markets: Optional[List[str]] = None
    logo_url: Optional[str] = None
    logo_original_url: Optional[str] = None
    cover_url: Optional[str] = None
    cover_original_url: Optional[str] = None
    photos: Optional[List[Any]] = None
    business_handle: Optional[str] = None
    business_email: Optional[str] = None
    certifications: Optional[List[str]] = None
    licenses: Optional[List[str]] = None
    insurance: Optional[List[str]] = None


class PersonalIdentityUpdate(BaseModel):
    """Edits to the account holder's PERSONAL identity (not the business listing)."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    handle: Optional[str] = None
    avatar: Optional[str] = None
    last_identity: Optional[str] = None  # "personal" | "business"


class ReviewUpdate(BaseModel):
    rating: int
    comment: Optional[str] = Field(default="", max_length=1000)
    category_ratings: Optional[Dict[str, int]] = None


class PostCreate(BaseModel):
    type: str
    title: str
    body: str
    market: str
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    allow_comments: bool = True
    expires_days: int = 30
    image_url: Optional[str] = None
    image_urls: Optional[List[str]] = None  # For Sale gallery (up to 6)
    price: Optional[float] = None       # For Sale posts
    condition: Optional[str] = None     # For Sale: New | Like New | Good | Fair | For parts
    identity: Optional[str] = None      # "personal" | "business" (composer "Posting as")


class PostExtend(BaseModel):
    days: int = 30


class EventCreate(BaseModel):
    title: str
    description: str
    market: str
    starts_at: str
    ends_at: Optional[str] = None
    location: Optional[str] = None
    is_volunteer: bool = False
    is_paid: bool = False
    is_free: bool = False
    is_race: bool = False
    volunteer_contact_email: Optional[str] = None
    volunteer_contact_phone: Optional[str] = None
    volunteer_reminder_lead_days: Optional[int] = 1
    price: Optional[float] = None
    registration_url: Optional[str] = None
    image_url: Optional[str] = None
    email_recipients: List[str] = []
    category: Optional[str] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    market: Optional[str] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    location: Optional[str] = None
    is_volunteer: Optional[bool] = None
    is_paid: Optional[bool] = None
    is_free: Optional[bool] = None
    is_race: Optional[bool] = None
    volunteer_contact_email: Optional[str] = None
    volunteer_contact_phone: Optional[str] = None
    volunteer_reminder_lead_days: Optional[int] = None
    price: Optional[float] = None
    registration_url: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)


class EventAdminUpdate(EventUpdate):
    """Admin-only event edits — can also override organizer / RSVP contact and
    fix imported (aggregator) events that scraped incorrectly."""
    organizer_name: Optional[str] = None
    organizer_email: Optional[str] = None


class EventRecipientsUpdate(BaseModel):
    email_recipients: List[str] = []


class CheckoutBody(BaseModel):
    package_id: str
    origin_url: str


class MessageSend(BaseModel):
    body: str
    identity: Optional[str] = None       # sender's "Posting as" for this message
    to_identity: Optional[str] = None     # recipient identity: "personal" | "business"
    thread_id: Optional[str] = None       # reply target: keeps a reply in its own thread


class GroupCreate(BaseModel):
    participant_ids: List[str] = []
    title: Optional[str] = None
    body: str
    identity: Optional[str] = None


class MarketRequest(BaseModel):
    market_name: str
    requester_email: Optional[str] = None


class NewsletterToggle(BaseModel):
    newsletter_opt_in: bool


class RegistrationCreate(BaseModel):
    kind: str = "attendee"


class CrewBankJoin(BaseModel):
    positions: List[str] = []
    experience: Optional[str] = None
    experience_types: List[str] = []
    sailing_style: Optional[Dict[str, int]] = None
    notes: Optional[str] = None
    availability: Optional[str] = None
    markets: List[str] = []
    contact_via: str = "in-app"


class CrewStatusUpdate(BaseModel):
    status: str


class StandaloneCrewUpsert(BaseModel):
    positions: List[str] = []
    experience: Optional[str] = None
    experience_types: List[str] = []
    sailing_style: Optional[Dict[str, int]] = None
    notes: Optional[str] = None
    availability: Optional[str] = None
    markets: List[str] = []
    contact_via: str = "in-app"


class ReviewRatings(BaseModel):
    # Overall is required and is the value the reviewer enters (never computed).
    # The four dimensions are optional. Safety is no longer accepted — extra keys
    # (including "safety") are rejected so old clients can't post it on new reviews.
    model_config = {"extra": "forbid"}
    overall: int
    personality: Optional[int] = None
    skill: Optional[int] = None
    promptness: Optional[int] = None
    communication: Optional[int] = None


class ReviewSessionCreate(BaseModel):
    relationship: str  # customer_pro | owner_crew | sailor_sailor | owner_owner | pro_pro
    counterparty_id: str
    context_note: Optional[str] = Field(default=None, max_length=200)
    event_id: Optional[str] = None
    boat_pro_id: Optional[str] = None
    ratings: ReviewRatings  # reviewer submits in one step; review starts hidden
    comment: Optional[str] = Field(default=None, max_length=1000)
    as_identity: Optional[str] = None  # "personal" | "business"; required personal for pro_pro
    target_identity: Optional[str] = None  # "business" | "personal"; which Boat Pro identity is reviewed


class ReviewAccept(BaseModel):
    ratings: Optional[ReviewRatings] = None  # review-back by the reviewee (reveals both)
    comment: Optional[str] = Field(default=None, max_length=1000)


class TwoWayReviewEdit(BaseModel):
    model_config = {"extra": "forbid"}
    ratings: ReviewRatings
    comment: Optional[str] = Field(default=None, max_length=1000)
    context_note: Optional[str] = Field(default=None, max_length=200)


class ReviewFlag(BaseModel):
    reason: str = "did_not_work_together"
    note: Optional[str] = Field(default=None, max_length=1000)


class ReviewReply(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class AdminHoldBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class AdminRemoveReviewBody(BaseModel):
    author_id: str
    reason: str = Field(min_length=1, max_length=1000)


class ReviewSubmit(BaseModel):
    ratings: ReviewRatings
    comment: Optional[str] = None


class ReviewEdit(BaseModel):
    ratings: ReviewRatings
    comment: Optional[str] = None


class CommentCreate(BaseModel):
    body: str
    parent_id: Optional[str] = None
    identity: Optional[str] = None
