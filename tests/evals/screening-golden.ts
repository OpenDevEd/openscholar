/**
 * Golden set for extraction eval testing.
 *
 * 20 hand-labeled cases with realistic academic paper body text excerpts.
 * Distribution:
 *   - 7 include, 7 exclude, 6 insufficient_evidence
 *   - 4 pmc, 4 arxiv, 4 unpdf, 4 gemini, 4 abstract_only
 *     (satisfies: >= 3 pmc, >= 3 arxiv, >= 3 unpdf/gemini)
 *
 * Each case has a precise expectedSourceSpan pointing to the evidence
 * location within paperBodyText.
 */

export interface GoldenCase {
  paperId: string;
  paperBodyText: string;
  question: string;
  expectedAnswer: string;
  expectedVerdict: "include" | "exclude" | "insufficient_evidence";
  expectedSourceSpan: { startChar: number; endChar: number };
  parsingSource: "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only";
}

// ---------------------------------------------------------------------------
// Helper: build a case and validate the source span at module load time
// ---------------------------------------------------------------------------

function makeCase(c: GoldenCase): GoldenCase {
  const slice = c.paperBodyText.slice(
    c.expectedSourceSpan.startChar,
    c.expectedSourceSpan.endChar,
  );
  if (slice.length === 0) {
    throw new Error(
      `Golden case ${c.paperId}: source span is empty (${c.expectedSourceSpan.startChar}-${c.expectedSourceSpan.endChar})`,
    );
  }
  return c;
}

// ---------------------------------------------------------------------------
// Golden set data
// ---------------------------------------------------------------------------

export const SCREENING_GOLDEN_SET: readonly GoldenCase[] = [
  // =========================================================================
  // INCLUDE cases (7)
  // =========================================================================

  // 1 - include / pmc
  makeCase({
    paperId: "golden-001",
    paperBodyText:
      "Introduction: Cardiovascular disease remains the leading cause of mortality worldwide. Methods: We conducted a randomized controlled trial (RCT) enrolling 1,247 patients with diagnosed hypertension across 12 clinical centers. Participants were randomly assigned to receive either the experimental ACE inhibitor compound (n=623) or placebo (n=624). The primary endpoint was reduction in systolic blood pressure at 12 weeks. Results: The treatment group showed a mean reduction of 18.3 mmHg (95% CI: 16.1-20.5) compared to 4.2 mmHg in the placebo group (p < 0.001). Adverse events were reported in 8.2% of treated patients versus 7.9% in the placebo arm. Conclusion: The novel ACE inhibitor demonstrates significant efficacy in reducing blood pressure in hypertensive patients.",
    question: "What was the sample size of the study?",
    expectedAnswer: "1,247 patients",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 131, endChar: 216 },
    parsingSource: "pmc",
  }),

  // 2 - include / arxiv
  makeCase({
    paperId: "golden-002",
    paperBodyText:
      "Abstract: We present a novel transformer architecture for low-resource language translation. Related Work: Previous approaches to neural machine translation have relied heavily on large parallel corpora. Our Approach: We propose the Sparse Attention Transformer (SAT), which reduces the computational complexity from O(n^2) to O(n log n) by employing learnable sparse attention patterns. We trained SAT on 14 language pairs with fewer than 100,000 parallel sentences each. Experiments: On the FLORES-101 benchmark, SAT achieved a BLEU score of 28.4 averaged across all 14 language pairs, outperforming the baseline mBART model (BLEU 23.1) by 5.3 points. Training required only 4 A100 GPUs for 72 hours, compared to 32 GPUs for the baseline. Conclusion: Our method demonstrates that sparse attention mechanisms can significantly improve translation quality in low-resource settings while reducing computational costs.",
    question: "What BLEU score did the proposed model achieve?",
    expectedAnswer: "28.4",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 464, endChar: 580 },
    parsingSource: "arxiv",
  }),

  // 3 - include / unpdf
  makeCase({
    paperId: "golden-003",
    paperBodyText:
      "Study Design and Participants: This prospective cohort study followed 3,892 adults aged 45-75 years over a median follow-up period of 8.6 years. Participants were recruited from primary care clinics in the metropolitan area between January 2014 and December 2016. Exposure Assessment: Dietary intake was assessed using validated food frequency questionnaires administered at baseline and at 2-year intervals. We categorized participants into tertiles of ultra-processed food consumption based on the NOVA classification system. Outcome Measures: The primary outcome was incident type 2 diabetes, confirmed by fasting glucose >= 126 mg/dL or HbA1c >= 6.5% on two separate occasions. Results: During follow-up, 412 participants (10.6%) developed type 2 diabetes. Participants in the highest tertile of ultra-processed food intake had a hazard ratio of 1.74 (95% CI: 1.38-2.19) for developing diabetes compared to those in the lowest tertile, after adjusting for age, sex, BMI, physical activity, smoking, and family history.",
    question:
      "What was the hazard ratio for diabetes in the highest ultra-processed food intake group?",
    expectedAnswer: "1.74 (95% CI: 1.38-2.19)",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 708, endChar: 896 },
    parsingSource: "unpdf",
  }),

  // 4 - include / gemini
  makeCase({
    paperId: "golden-004",
    paperBodyText:
      "Background: Antibiotic resistance poses a critical threat to global public health. We investigated the effectiveness of a novel bacteriophage therapy against multidrug-resistant Pseudomonas aeruginosa infections. Methods: In this single-arm phase II clinical trial, 86 patients with chronic wound infections caused by MDR P. aeruginosa received topical bacteriophage cocktail treatment for 14 days. The primary outcome was microbiological clearance at day 21. Results: Complete microbiological clearance was achieved in 67 of 86 patients (77.9%). The median time to clearance was 11 days (IQR: 8-14 days). No serious adverse events were attributed to the phage therapy. Wound healing was observed in 71.2% of patients by day 42. Discussion: These results suggest that bacteriophage therapy is a promising alternative for treating MDR infections when conventional antibiotics fail.",
    question: "What percentage of patients achieved microbiological clearance?",
    expectedAnswer: "77.9%",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 396, endChar: 480 },
    parsingSource: "gemini",
  }),

  // 5 - include / pmc
  makeCase({
    paperId: "golden-005",
    paperBodyText:
      "Objective: To evaluate the impact of a school-based mindfulness intervention on adolescent anxiety and academic performance. Design: Cluster randomized controlled trial conducted across 24 secondary schools. Intervention: A structured 8-week mindfulness program delivered by trained facilitators during regular school hours. Participants: 2,156 students aged 13-16 years participated (1,082 intervention, 1,074 control). Results: At 6-month follow-up, the intervention group showed significantly lower anxiety scores on the GAD-7 scale (mean difference: -2.8 points, 95% CI: -3.4 to -2.2, p < 0.001) compared to controls. Academic performance, measured by standardized test scores, improved by 0.3 standard deviations in the intervention group. Attendance rates were 94.7% across sessions, indicating high acceptability.",
    question: "Did the study use a randomized controlled trial design?",
    expectedAnswer: "Yes, cluster randomized controlled trial",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 113, endChar: 184 },
    parsingSource: "pmc",
  }),

  // 6 - include / arxiv
  makeCase({
    paperId: "golden-006",
    paperBodyText:
      "Introduction: Federated learning enables collaborative model training without sharing raw data. However, communication overhead remains a significant bottleneck. Contribution: We propose FedCompress, a gradient compression framework that reduces communication costs by 87% while maintaining model accuracy within 0.5% of the uncompressed baseline. Architecture: FedCompress uses a two-stage pipeline: (1) top-k sparsification retaining only the 1% most significant gradient updates, and (2) quantization of remaining values to 8-bit integers. Evaluation: We evaluated on CIFAR-100 with 100 heterogeneous clients. FedCompress achieved 76.2% test accuracy after 500 rounds, compared to 76.8% for uncompressed FedAvg. The total communication volume was reduced from 4.2 TB to 546 GB across all clients. Conclusion: FedCompress enables practical federated learning deployments on bandwidth-constrained networks.",
    question: "What was the communication cost reduction achieved?",
    expectedAnswer: "87%",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 198, endChar: 365 },
    parsingSource: "arxiv",
  }),

  // 7 - include / gemini
  makeCase({
    paperId: "golden-007",
    paperBodyText:
      "Introduction: Sleep disorders affect an estimated 50-70 million Americans annually. Study Aim: We examined the efficacy of cognitive behavioral therapy for insomnia (CBT-I) delivered via a smartphone application compared to standard sleep hygiene education. Methods: A double-blind randomized trial was conducted with 534 adults diagnosed with chronic insomnia disorder. Participants were randomized to app-based CBT-I (n=268) or a control app providing sleep hygiene tips (n=266). The intervention lasted 6 weeks with daily engagement tracking. Outcomes: The primary outcome was change in Pittsburgh Sleep Quality Index (PSQI) score at 8 weeks. The CBT-I group showed a mean PSQI improvement of 4.7 points (SD 2.1) versus 1.3 points (SD 1.8) in the control group (p < 0.001). Sleep onset latency decreased by 22 minutes in the intervention arm. App engagement was 78% over the 6-week period.",
    question: "What intervention was tested in the study?",
    expectedAnswer:
      "Cognitive behavioral therapy for insomnia (CBT-I) delivered via a smartphone application",
    expectedVerdict: "include",
    expectedSourceSpan: { startChar: 130, endChar: 289 },
    parsingSource: "gemini",
  }),

  // =========================================================================
  // EXCLUDE cases (7)
  // =========================================================================

  // 8 - exclude / pmc
  makeCase({
    paperId: "golden-008",
    paperBodyText:
      "Background: Air pollution is a major environmental health concern in urban areas. This narrative review examines the relationship between particulate matter exposure and respiratory disease outcomes. We searched PubMed, Scopus, and Web of Science for studies published between 2010 and 2023. Literature Synthesis: A total of 89 studies met our inclusion criteria. The majority of studies (n=64, 71.9%) reported significant associations between PM2.5 exposure and increased respiratory hospitalizations. However, methodological heterogeneity precluded formal meta-analysis. Several studies noted dose-response relationships, with each 10 ug/m3 increase in PM2.5 associated with a 3-8% increase in emergency department visits. Gaps and Future Directions: Few studies have examined the combined effects of PM2.5 and ozone, and longitudinal studies spanning more than 10 years remain scarce. Conclusion: Current evidence strongly supports the adverse respiratory effects of PM2.5 exposure, but standardized outcome measures are needed.",
    question: "What was the sample size of the study?",
    expectedAnswer:
      "Not applicable - this is a narrative review, not an original study with enrolled participants",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 63, endChar: 183 },
    parsingSource: "pmc",
  }),

  // 9 - exclude / arxiv
  makeCase({
    paperId: "golden-009",
    paperBodyText:
      "Abstract: We present a survey of recent advances in large language model alignment techniques. This paper reviews 127 publications from 2022-2024 covering reinforcement learning from human feedback (RLHF), direct preference optimization (DPO), constitutional AI, and debate-based approaches. Taxonomy: We categorize alignment methods into four families based on their feedback mechanism: scalar reward, pairwise preference, rule-based, and adversarial. Analysis: Empirical comparisons across benchmarks show that DPO-family methods achieve comparable alignment quality to RLHF with 40-60% lower computational cost. However, no single method dominates across all evaluation dimensions including helpfulness, harmlessness, and honesty. Open Problems: Key challenges remain in scalable oversight, distributional shift between training and deployment, and measuring alignment in open-ended generation tasks.",
    question: "Did the study use a randomized controlled trial design?",
    expectedAnswer:
      "No - this is a survey paper reviewing existing publications, not an experimental study",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 0, endChar: 131 },
    parsingSource: "arxiv",
  }),

  // 10 - exclude / unpdf
  makeCase({
    paperId: "golden-010",
    paperBodyText:
      "Introduction: Coral reef ecosystems provide critical ecological services to marine biodiversity. This study uses computational fluid dynamics (CFD) modeling to simulate water flow patterns around coral reef structures under varying wave conditions. Methods: We constructed 3D models of branching and massive coral morphologies using photogrammetry data from field surveys at the Great Barrier Reef. Simulations were conducted using OpenFOAM with Reynolds-averaged Navier-Stokes equations. Results: Flow velocity decreased by 40-65% within the reef canopy compared to freestream conditions. Turbulent kinetic energy was highest at the reef crest, reaching 0.12 m2/s2. The branching morphology created more complex flow patterns with higher residence times. Discussion: These hydrodynamic findings have implications for larval transport and nutrient delivery but do not directly address reef health interventions or conservation strategies.",
    question: "What intervention was tested to improve coral reef health?",
    expectedAnswer:
      "No intervention was tested - this is a CFD modeling study of water flow patterns, not an intervention study",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 98, endChar: 266 },
    parsingSource: "unpdf",
  }),

  // 11 - exclude / abstract_only
  makeCase({
    paperId: "golden-011",
    paperBodyText:
      "This editorial discusses the ethical implications of using artificial intelligence in clinical decision-making. As machine learning models become increasingly integrated into diagnostic workflows, we must address questions of accountability, transparency, and patient consent. The black-box nature of deep learning models presents a fundamental challenge to the principle of informed consent. We argue that regulatory frameworks must evolve to require explainability standards for AI-assisted diagnoses. Furthermore, bias in training data can perpetuate health disparities, particularly affecting underrepresented populations. The medical community must develop guidelines that balance innovation with patient safety and equity.",
    question: "What was the primary outcome measure of the study?",
    expectedAnswer:
      "Not applicable - this is an editorial/opinion piece, not a research study",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 0, endChar: 96 },
    parsingSource: "abstract_only",
  }),

  // 12 - exclude / gemini
  makeCase({
    paperId: "golden-012",
    paperBodyText:
      "Introduction: Pain management in pediatric patients requires careful consideration of developmental pharmacology. Case Presentation: A 7-year-old male presented to the emergency department with acute appendicitis. The patient had a history of attention deficit hyperactivity disorder managed with methylphenidate. Perioperative management included ketorolac 0.5 mg/kg IV and acetaminophen 15 mg/kg. Post-appendectomy, the patient developed paradoxical agitation during recovery. Management: The agitation was managed with dexmedetomidine 0.5 mcg/kg bolus followed by a 0.2 mcg/kg/h infusion. The patient stabilized within 45 minutes and was discharged on postoperative day 2. Discussion: This case highlights the importance of considering drug interactions between stimulant medications and anesthetic agents.",
    question: "How many participants were enrolled in the study?",
    expectedAnswer:
      "Not applicable - this is a single case report, not a study with enrolled participants",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 114, endChar: 192 },
    parsingSource: "gemini",
  }),

  // 13 - exclude / arxiv
  makeCase({
    paperId: "golden-013",
    paperBodyText:
      "Theoretical Framework: We develop a mathematical framework for analyzing convergence properties of stochastic gradient descent in non-convex optimization landscapes. Definitions: Let f: R^d -> R be an L-smooth function satisfying the Polyak-Lojasiewicz condition with parameter mu. We consider the stochastic oracle model where gradient estimates have bounded variance sigma^2. Main Results: Theorem 1 establishes that SGD with step size eta = 1/(2L) converges at rate O(exp(-mu*t) + sigma^2/(mu*n)) where t is the iteration count and n is the batch size. Theorem 2 shows this rate is optimal up to constant factors under our assumptions. Corollary: For epsilon-accuracy, the total gradient complexity is O((L/mu)*log(1/epsilon) + sigma^2/(mu*epsilon)). Proof Strategy: The proofs rely on a novel Lyapunov function combining the gradient norm and function value gap.",
    question: "What clinical intervention was evaluated?",
    expectedAnswer:
      "No clinical intervention - this is a theoretical mathematics paper on optimization algorithms",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 0, endChar: 121 },
    parsingSource: "arxiv",
  }),

  // 14 - exclude / unpdf
  makeCase({
    paperId: "golden-014",
    paperBodyText:
      "Introduction: Understanding voter behavior requires rigorous analysis of demographic and socioeconomic factors. This paper presents a retrospective analysis of voting patterns in the 2020 and 2022 US elections using publicly available county-level data. Data Sources: We compiled data from the US Census Bureau American Community Survey, the MIT Election Data and Science Lab, and the Bureau of Labor Statistics. Variables included median household income, educational attainment, racial demographics, unemployment rate, and urbanization index. Methods: We employed spatial regression models with county-level fixed effects to account for geographic clustering. Results: Educational attainment was the strongest predictor of voting patterns (beta = 0.42, p < 0.001), followed by urbanization index (beta = 0.38, p < 0.001). Model R-squared was 0.71.",
    question: "Was the study a randomized controlled trial?",
    expectedAnswer:
      "No - this is an observational retrospective analysis of existing election data, not an RCT",
    expectedVerdict: "exclude",
    expectedSourceSpan: { startChar: 82, endChar: 233 },
    parsingSource: "unpdf",
  }),

  // =========================================================================
  // INSUFFICIENT_EVIDENCE cases (6)
  // =========================================================================

  // 15 - insufficient_evidence / abstract_only
  makeCase({
    paperId: "golden-015",
    paperBodyText:
      "Background: Depression affects over 280 million people worldwide. Objective: To compare the efficacy of two selective serotonin reuptake inhibitors in treatment-resistant depression. Methods: Multicenter double-blind randomized trial. Patients aged 18-65 with treatment-resistant major depressive disorder were enrolled. Primary outcome was change in Hamilton Depression Rating Scale at 12 weeks. Results: Full results will be published upon study completion. Preliminary data suggest both compounds show promise. Study Status: Enrollment is ongoing. Expected completion date is December 2026.",
    question: "What was the effect size of the treatment?",
    expectedAnswer:
      "Insufficient evidence - the study is still ongoing and full results have not been published",
    expectedVerdict: "insufficient_evidence",
    expectedSourceSpan: { startChar: 368, endChar: 478 },
    parsingSource: "abstract_only",
  }),

  // 16 - insufficient_evidence / pmc
  makeCase({
    paperId: "golden-016",
    paperBodyText:
      "Introduction: Early detection of pancreatic cancer remains challenging due to the absence of reliable biomarkers. Study Design: We analyzed serum samples from a biobank containing specimens from 2,300 individuals collected between 2008 and 2018. Biomarker Panel: Using mass spectrometry, we identified a panel of 12 candidate protein biomarkers that showed differential expression between cases and controls. Results: The biomarker panel achieved an area under the receiver operating characteristic curve (AUROC) of 0.89 in the discovery cohort. However, external validation in an independent cohort has not yet been performed. The specificity at 95% sensitivity was 72%, which may lead to a high false-positive rate in population screening. Limitations: The discovery cohort was drawn from a single institution and may not represent the general population. Cross-reactivity with chronic pancreatitis was not assessed.",
    question:
      "Was the biomarker panel validated in an external cohort?",
    expectedAnswer:
      "No - external validation has not yet been performed",
    expectedVerdict: "insufficient_evidence",
    expectedSourceSpan: { startChar: 397, endChar: 492 },
    parsingSource: "pmc",
  }),

  // 17 - insufficient_evidence / arxiv
  makeCase({
    paperId: "golden-017",
    paperBodyText:
      "Abstract: We introduce ProteinFold-X, a deep learning model for protein structure prediction that leverages evolutionary coupling analysis and geometric deep learning. Architecture: ProteinFold-X uses an equivariant graph neural network operating on residue-level contact maps derived from multiple sequence alignments. The model has 340M parameters and was trained on structures from the Protein Data Bank released before May 2024. Benchmark: On the CASP16 free-modeling targets, ProteinFold-X achieved a median GDT-TS score of 71.2. We note that performance on membrane proteins and intrinsically disordered regions was not evaluated due to limited test data. Runtime: Inference requires approximately 3 minutes per protein on a single V100 GPU.",
    question:
      "How does the model perform on membrane proteins?",
    expectedAnswer:
      "Insufficient evidence - performance on membrane proteins was not evaluated due to limited test data",
    expectedVerdict: "insufficient_evidence",
    expectedSourceSpan: { startChar: 472, endChar: 601 },
    parsingSource: "arxiv",
  }),

  // 18 - insufficient_evidence / unpdf
  makeCase({
    paperId: "golden-018",
    paperBodyText:
      "Background: Microplastic contamination of freshwater systems is an emerging environmental concern. Objective: To quantify microplastic concentrations in drinking water treatment plants. Methods: We collected water samples at five stages of treatment (intake, post-coagulation, post-filtration, post-disinfection, and distribution outlet) across 8 municipal treatment plants in the Great Lakes region. Sample Analysis: Samples were filtered through 0.45 um membranes and analyzed using micro-FTIR spectroscopy. Results: Microplastic concentrations at intake ranged from 12.3 to 89.7 particles per liter. Post-treatment concentrations were reduced by 73-91% across all plants. The most common polymer types were polyethylene (42%), polypropylene (28%), and polystyrene (17%). Health Impact: The health implications of residual microplastics in treated drinking water remain unclear and require further toxicological investigation.",
    question:
      "What are the health effects of microplastic exposure from drinking water?",
    expectedAnswer:
      "Insufficient evidence - the health implications remain unclear and require further toxicological investigation",
    expectedVerdict: "insufficient_evidence",
    expectedSourceSpan: { startChar: 680, endChar: 834 },
    parsingSource: "unpdf",
  }),

  // 19 - insufficient_evidence / abstract_only
  makeCase({
    paperId: "golden-019",
    paperBodyText:
      "We report a genome-wide association study (GWAS) of educational attainment in a cohort of 1.1 million individuals of European ancestry. We identified 3,952 genome-wide significant loci explaining approximately 12-16% of the variance in years of education. Polygenic scores constructed from these loci showed modest predictive power (R-squared = 0.13) in held-out samples. The genetic architecture was highly polygenic with the largest individual effect size being 0.04 standard deviations. Gene ontology analysis implicated neuronal development and synaptic signaling pathways. However, the causal mechanisms linking identified variants to educational outcomes remain speculative. Cross-ancestry portability of the polygenic score has not been assessed, and the cohort was restricted to European ancestry populations.",
    question:
      "Does the polygenic score generalize to non-European ancestry populations?",
    expectedAnswer:
      "Insufficient evidence - cross-ancestry portability has not been assessed; the cohort was restricted to European ancestry",
    expectedVerdict: "insufficient_evidence",
    expectedSourceSpan: { startChar: 590, endChar: 747 },
    parsingSource: "abstract_only",
  }),

  // 20 - insufficient_evidence / gemini
  makeCase({
    paperId: "golden-020",
    paperBodyText:
      "Introduction: Autonomous vehicle (AV) safety validation requires extensive testing under diverse conditions. Study Overview: We present results from a 12-month deployment of 50 autonomous vehicles in mixed urban traffic in Phoenix, Arizona. The fleet accumulated 2.3 million miles of autonomous driving. Safety Metrics: The overall disengagement rate was 0.8 per 1,000 miles. There were zero at-fault collisions during the study period. Near-miss events, defined as situations requiring emergency braking or evasive maneuvers, occurred at a rate of 2.1 per 10,000 miles. Weather Conditions: Testing was conducted primarily in clear weather conditions. Performance during adverse weather such as heavy rain, fog, or snow has not been characterized in this deployment. Nighttime driving represented only 12% of total miles driven.",
    question:
      "How does the autonomous vehicle perform in heavy rain or snow conditions?",
    expectedAnswer:
      "Insufficient evidence - performance during adverse weather has not been characterized in this deployment",
    expectedVerdict: "insufficient_evidence",
    expectedSourceSpan: { startChar: 543, endChar: 723 },
    parsingSource: "gemini",
  }),
] as const;
