import { z } from "zod";

export const genomeRecordDataSchema = z.object({
  synthetic: z.literal(true),
  careSetting: z.literal("secondary-care"),
  gene: z.literal("CYP2C19"),
  medication: z.literal("clopidogrel"),
  assay: z.literal("targeted-SNP-panel"),
  profileVersion: z.literal("synthetic-cyp2c19-v1"),
  source: z.literal("Authored synthetic SNP calls; not a clinical laboratory result"),
  variantReference: z.literal("https://www.pharmvar.org/gene/cyp2c19"),
  phasing: z.literal("unphased"),
  variants: z.tuple([
    z.object({ rsid: z.literal("rs4244285"), reference: z.literal("G"), alternate: z.literal("A"), genotype: z.enum(["G/G", "G/A", "A/A"]) }),
    z.object({ rsid: z.literal("rs4986893"), reference: z.literal("G"), alternate: z.literal("A"), genotype: z.enum(["G/G", "G/A", "A/A"]) }),
    z.object({ rsid: z.literal("rs12248560"), reference: z.literal("C"), alternate: z.literal("T"), genotype: z.enum(["C/C", "C/T", "T/T"]) }),
  ]),
});
export type GenomeRecordData = z.infer<typeof genomeRecordDataSchema>;
