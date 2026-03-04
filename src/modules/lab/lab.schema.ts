export const searchTestSchema = {
  querystring: {
    type: "object",
    properties: {
      keyword: { type: "string", minLength: 0 },
    },
  },
} as const;

export const searchTestBodySchema = {
  body: {
    type: "object",
    properties: {
      keyword: { type: "string", minLength: 0 },
    },
  },
} as const;

export const catalogQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      keyword: { type: "string", minLength: 0 },
      limit: { type: "number", minimum: 1, maximum: 2000 },
      offset: { type: "number", minimum: 0, maximum: 200000 },
    },
  },
} as const;

export const testDescriptionSchema = {
  params: {
    type: "object",
    required: ["testid"],
    properties: {
      testid: { type: "string", minLength: 1 },
    },
  },
} as const;

export const testDescriptionBodySchema = {
  body: {
    type: "object",
    required: ["testid"],
    properties: {
      testid: { type: "string", minLength: 1 },
    },
  },
} as const;

export const pincodeSchema = {
  params: {
    type: "object",
    required: ["pincode"],
    properties: {
      pincode: { type: "string", minLength: 3 },
    },
  },
} as const;

export const pincodeQuerySchema = {
  querystring: {
    type: "object",
    required: ["pincode"],
    properties: {
      pincode: { type: "string", minLength: 3 },
    },
  },
} as const;

export const referenceSchema = {
  params: {
    type: "object",
    required: ["reference"],
    properties: {
      reference: { type: "string", minLength: 1 },
    },
  },
} as const;

export const sendNotificationSchema = {
  body: {
    type: "object",
    required: ["order_id", "reference_id", "request_status", "authorization"],
    properties: {
      order_id: { type: "string", minLength: 1 },
      reference_id: { type: "string", minLength: 1 },
      request_status: { type: "string", minLength: 1 },
      authorization: { type: "string", minLength: 1 },
      old_date: { type: "string" },
      new_date: { type: "string" },
      agent_name: { type: "string" },
      agent_contact: { type: "string" },
      tracking_url: { type: "string" },
      sample_type: { type: "string" },
      sample_id: { type: "string" },
      reason: { type: "string" },
      report_type: { type: "string" },
      report_url: { type: "string" },
      completed_test: { type: "array", items: { type: "string" } },
      pending_test: { type: "array", items: { type: "string" } },
      digital_report: { type: "string" },
      receipt_url: { type: "string" },
    },
    additionalProperties: true,
  },
} as const;

export const cancelOrderSchema = {
  body: {
    type: "object",
    required: ["reference", "closedReason"],
    properties: {
      reference: { type: "string", minLength: 1 },
      closedReason: { type: "string", minLength: 1 },
    },
  },
} as const;

export const rescheduleOrderSchema = {
  body: {
    type: "object",
    required: ["reference", "new_date", "old_date"],
    properties: {
      reference: { type: "string", minLength: 1 },
      new_date: { type: "number" },
      old_date: { type: "number" },
    },
  },
} as const;
