import { z } from "zod"

export const AdoptionStatusSchema = z.enum(["TENTATIVE","ACCEPTED","EDITED_ACCEPTED","DISCARDED","SUPERSEDED","INVALIDATED","ARCHIVED"]).describe("Artifact adoption 7 态。canonical 来源 30-contract-glossary §3.2 + ADR-0001。映射到 status family 见 ADR-0002 §5。")
export type AdoptionStatus = z.infer<typeof AdoptionStatusSchema>
