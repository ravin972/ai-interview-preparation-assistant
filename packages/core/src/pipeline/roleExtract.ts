/**
 * Deterministic extraction of role metadata, company name, and responsibilities.
 */
import type { Section } from '../extract/sections.js';

export interface ExtractedRoleInfo {
  company: string;
  role: string;
  location: string;
  seniority: string;
  responsibilities: string[];
}

export function extractRoleAndCompany(
  jdText: string,
  companyUrl: string,
  sections: readonly Section[],
): ExtractedRoleInfo {
  const lines = jdText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let company = '';
  let role = '';
  let location = 'Hybrid / Remote';
  let seniority = 'mid';

  // 1. Role Title
  const firstLine = lines[0];
  if (firstLine !== undefined && firstLine.length < 80 && !/[.!?]$/.test(firstLine)) {
    role = firstLine;
  } else {
    const hiringMatch =
      /(?:hiring|looking for)\s+(?:a|an)\s+([A-Z][A-Za-z0-9\s/]+?)(?:\s+to|\s+for|\s+in|\.)/i.exec(
        jdText,
      );
    if (hiringMatch && hiringMatch[1] !== undefined) {
      role = hiringMatch[1].trim();
    } else {
      role = 'Software Engineer';
    }
  }

  // 2. Seniority
  const roleLower = role.toLowerCase();
  if (
    roleLower.includes('senior') ||
    roleLower.includes('lead') ||
    roleLower.includes('staff') ||
    roleLower.includes('principal')
  ) {
    seniority = 'senior';
  } else if (
    roleLower.includes('junior') ||
    roleLower.includes('entry') ||
    roleLower.includes('intern') ||
    roleLower.includes('associate')
  ) {
    seniority = 'junior';
  }

  // 3. Company Name
  const secondLine = lines[1];
  if (secondLine !== undefined && secondLine.includes('-')) {
    const parts = secondLine.split('-');
    company = (parts[0] ?? '').trim();
    if (parts[1] !== undefined) location = parts[1].trim();
  } else if (
    secondLine !== undefined &&
    secondLine.length < 60 &&
    !/[.!?]$/.test(secondLine)
  ) {
    company = secondLine.trim();
  }

  if (!company) {
    const companyMatch =
      /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)\s+(?:is hiring|is looking for)/i.exec(
        jdText,
      );
    if (companyMatch && companyMatch[1] !== undefined) {
      company = companyMatch[1].trim();
    } else {
      try {
        const parsed = new URL(companyUrl);
        const hostParts = parsed.hostname.split('.');
        const domain =
          hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0];
        if (domain !== undefined && domain.length > 0) {
          company = domain.charAt(0).toUpperCase() + domain.slice(1);
        } else {
          company = 'Company';
        }
      } catch {
        company = 'Company';
      }
    }
  }

  // 4. Responsibilities
  const responsibilities: string[] = [];
  const respSection = sections.find((s) => s.kind === 'responsibilities');

  if (respSection) {
    const respLines = respSection.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of respLines) {
      const match = /^[-*•]\s+(.*)$/.exec(line);
      if (match && match[1] !== undefined && match[1].length > 5) {
        responsibilities.push(match[1].trim());
      }
    }
  }

  if (responsibilities.length === 0) {
    for (const line of lines.slice(1, 8)) {
      if (!line) continue;
      const match = /^[-*•]\s+(.*)$/.exec(line);
      if (
        match &&
        match[1] !== undefined &&
        match[1].length > 5 &&
        !match[1].toLowerCase().includes('holiday')
      ) {
        responsibilities.push(match[1].trim());
      }
    }
  }

  if (responsibilities.length === 0) {
    responsibilities.push(
      'Design, implement, and maintain high-quality software features and systems.',
      'Collaborate with cross-functional team members on architecture and code reviews.',
      'Own services in production, ensuring performance, reliability, and observability.',
    );
  }

  return {
    company,
    role,
    location,
    seniority,
    responsibilities: responsibilities.slice(0, 10),
  };
}
