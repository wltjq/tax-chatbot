/**
 * 2024/2025 South Korean Income Tax Calculator Module
 */

export interface TaxInput {
  annualSalary: number; // 연간 총급여액 (원)
  hasSpouse: boolean; // 배우자 유무
  numberOfDependents: number; // 부양가족 수 (본인/배우자 제외)
  numberOfElderly: number; // 경로우대자 수 (만 70세 이상 부양가족)
  numberOfDisabled: number; // 장애인 수
  isSingleParent: boolean; // 한부모 여부
  isFemaleHeadOfHouseholdWithLowIncome: boolean; // 부녀자 공제 대상 여부 (여성 근로자, 소득 3천만원 이하 등)
}

export interface TaxResult {
  annualSalary: number;
  earnedIncomeDeduction: number; // 근로소득공제
  earnedIncomeAmount: number; // 근로소득금액 (총급여 - 근로소득공제)
  personalDeduction: number; // 인적공제 총액
  basicDeductionDetail: {
    self: number;
    spouse: number;
    dependents: number;
    total: number;
  };
  additionalDeductionDetail: {
    elderly: number;
    disabled: number;
    singleParent: number;
    femaleHead: number;
    total: number;
  };
  taxableIncome: number; // 과세표준 (근로소득금액 - 인적공제 등)
  calculatedTax: number; // 산출세액 (과세표준 * 세율)
  bracketRate: number; // 최고 세율 구간 (%)
  earnedIncomeTaxCredit: number; // 근로소득세액공제 (원)
  standardTaxCredit: number; // 표준세액공제 (원)
  estimatedTaxPayable: number; // 최종 결정세액 (산출세액 - 세액공제, 0 미만은 0)
}

/**
 * 1. 근로소득공제 계산 (Earned Income Deduction)
 * @param annualSalary 연간 총급여액 (원)
 */
export function calculateEarnedIncomeDeduction(annualSalary: number): number {
  let deduction = 0;
  
  if (annualSalary <= 5000000) {
    deduction = annualSalary * 0.70;
  } else if (annualSalary <= 15000000) {
    deduction = 3500000 + (annualSalary - 5000000) * 0.40;
  } else if (annualSalary <= 45000000) {
    deduction = 7500000 + (annualSalary - 15000000) * 0.15;
  } else if (annualSalary <= 100000000) {
    deduction = 12000000 + (annualSalary - 45000000) * 0.05;
  } else {
    deduction = 14750000 + (annualSalary - 100000000) * 0.02;
  }
  
  // 한도는 2,000만원
  return Math.min(20000000, Math.floor(deduction));
}

/**
 * 2. 인적공제 계산 (Personal Deduction)
 */
export function calculatePersonalDeductions(input: TaxInput): {
  basic: { self: number; spouse: number; dependents: number; total: number };
  additional: { elderly: number; disabled: number; singleParent: number; femaleHead: number; total: number };
  total: number;
} {
  // 기본공제: 1명당 150만원
  const selfDeduction = 1500000;
  const spouseDeduction = input.hasSpouse ? 1500000 : 0;
  const dependentsDeduction = input.numberOfDependents * 1500000;
  const basicTotal = selfDeduction + spouseDeduction + dependentsDeduction;
  
  // 추가공제
  const elderlyDeduction = input.numberOfElderly * 1000000; // 70세 이상 1명당 100만원
  const disabledDeduction = input.numberOfDisabled * 2000000; // 장애인 1명당 200만원
  
  // 한부모 공제와 부녀자 공제는 중복 배제 (한부모 공제가 우선 적용)
  let singleParentDeduction = 0;
  let femaleHeadDeduction = 0;
  
  if (input.isSingleParent) {
    singleParentDeduction = 1000000; // 한부모 100만원
  } else if (input.isFemaleHeadOfHouseholdWithLowIncome) {
    femaleHeadDeduction = 500000; // 부녀자 50만원
  }
  
  const additionalTotal = elderlyDeduction + disabledDeduction + singleParentDeduction + femaleHeadDeduction;
  
  return {
    basic: {
      self: selfDeduction,
      spouse: spouseDeduction,
      dependents: dependentsDeduction,
      total: basicTotal
    },
    additional: {
      elderly: elderlyDeduction,
      disabled: disabledDeduction,
      singleParent: singleParentDeduction,
      femaleHead: femaleHeadDeduction,
      total: additionalTotal
    },
    total: basicTotal + additionalTotal
  };
}

/**
 * 3. 산출세액 및 적용세율 계산 (Income Tax Bracket Calculation)
 * @param taxableIncome 과세표준 (원)
 */
export function calculateTaxBrackets(taxableIncome: number): { calculatedTax: number; bracketRate: number } {
  if (taxableIncome <= 0) {
    return { calculatedTax: 0, bracketRate: 0 };
  }
  
  let calculatedTax = 0;
  let bracketRate = 6;
  
  if (taxableIncome <= 14000000) {
    calculatedTax = taxableIncome * 0.06;
    bracketRate = 6;
  } else if (taxableIncome <= 50000000) {
    calculatedTax = 840000 + (taxableIncome - 14000000) * 0.15;
    bracketRate = 15;
  } else if (taxableIncome <= 88000000) {
    calculatedTax = 6240000 + (taxableIncome - 50000000) * 0.24;
    bracketRate = 24;
  } else if (taxableIncome <= 150000000) {
    calculatedTax = 15360000 + (taxableIncome - 88000000) * 0.35;
    bracketRate = 35;
  } else if (taxableIncome <= 300000000) {
    calculatedTax = 37060000 + (taxableIncome - 150000000) * 0.38;
    bracketRate = 38;
  } else if (taxableIncome <= 500000000) {
    calculatedTax = 94060000 + (taxableIncome - 300000000) * 0.40;
    bracketRate = 40;
  } else if (taxableIncome <= 1000000000) {
    calculatedTax = 174060000 + (taxableIncome - 500000000) * 0.42;
    bracketRate = 42;
  } else {
    calculatedTax = 384060000 + (taxableIncome - 1000000000) * 0.45;
    bracketRate = 45;
  }
  
  return {
    calculatedTax: Math.floor(calculatedTax),
    bracketRate
  };
}

/**
 * 4. 근로소득세액공제 (Earned Income Tax Credit)
 */
export function calculateEarnedIncomeTaxCredit(calculatedTax: number, annualSalary: number): number {
  if (calculatedTax <= 0) return 0;
  
  // 1) 공제액 산출
  let credit = 0;
  if (calculatedTax <= 1300000) {
    credit = calculatedTax * 0.55;
  } else {
    credit = 715000 + (calculatedTax - 1300000) * 0.30;
  }
  
  // 2) 한도 적용
  let limit = 740000;
  if (annualSalary <= 33000000) {
    limit = 740000;
  } else if (annualSalary <= 70000000) {
    limit = Math.max(660000, 740000 - (annualSalary - 33000000) * 0.008);
  } else {
    limit = Math.max(500000, 660000 - (annualSalary - 70000000) * 0.5);
  }
  
  return Math.floor(Math.min(credit, limit));
}

/**
 * 5. 표준세액공제 (Standard Tax Credit)
 * 근로소득자용 표준세액공제는 13만원 적용
 */
export function calculateStandardTaxCredit(): number {
  return 130000;
}

/**
 * 종합 소득세 계산 메인 함수
 */
export function calculateIncomeTax(input: TaxInput): TaxResult {
  const earnedIncomeDeduction = calculateEarnedIncomeDeduction(input.annualSalary);
  const earnedIncomeAmount = Math.max(0, input.annualSalary - earnedIncomeDeduction);
  
  const personalDeductionInfo = calculatePersonalDeductions(input);
  
  // 과세표준 = 근로소득금액 - 인적공제
  const taxableIncome = Math.max(0, earnedIncomeAmount - personalDeductionInfo.total);
  
  const bracketInfo = calculateTaxBrackets(taxableIncome);
  const earnedIncomeTaxCredit = calculateEarnedIncomeTaxCredit(bracketInfo.calculatedTax, input.annualSalary);
  const standardTaxCredit = calculateStandardTaxCredit();
  
  // 결정세액 = 산출세액 - 근로소득세액공제 - 표준세액공제
  const estimatedTaxPayable = Math.max(0, bracketInfo.calculatedTax - earnedIncomeTaxCredit - standardTaxCredit);
  
  return {
    annualSalary: input.annualSalary,
    earnedIncomeDeduction,
    earnedIncomeAmount,
    personalDeduction: personalDeductionInfo.total,
    basicDeductionDetail: personalDeductionInfo.basic,
    additionalDeductionDetail: personalDeductionInfo.additional,
    taxableIncome,
    calculatedTax: bracketInfo.calculatedTax,
    bracketRate: bracketInfo.bracketRate,
    earnedIncomeTaxCredit,
    standardTaxCredit,
    estimatedTaxPayable
  };
}
