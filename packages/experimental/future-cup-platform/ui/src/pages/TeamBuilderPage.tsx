import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Steps,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import type { TeamRecommendationPlanView } from '../api/contracts.ts'
import { PageHeading } from '../components/PageHeading.tsx'
import { TeamRecommendationDetails } from '../components/TeamRecommendationDetails.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import {
  adjustmentLabel,
  budgetLabel,
  designLabel,
  parallelismLabel,
  qualityLabel,
  questionPrompt,
  timeLabel,
} from '../team/recommendation-labels.ts'

type Plan = TeamRecommendationPlanView
type Question = Plan['questions'][number]
type Answer =
  | { readonly type: 'page-count'; readonly count: number }
  | {
    readonly type: 'module-parallelism'
    readonly moduleCount: number
    readonly parallelism: 'serial' | 'balanced' | 'parallel'
  }
  | {
    readonly type: 'quality-verification'
    readonly level: 'basic' | 'standard' | 'high' | 'critical'
  }

interface ClarificationValues {
  readonly pageCount?: number
  readonly moduleCount?: number
  readonly parallelism?: 'serial' | 'balanced' | 'parallel'
  readonly quality?: 'basic' | 'standard' | 'high' | 'critical'
}

type Pending = 'structuring' | 'recommending' | 'adjusting' | 'adopting'

/**
 * Convert the small clarification form into the server-owned answer contract.
 * @param questions - outstanding server-owned clarification questions.
 * @param values - user-entered clarification values.
 * @returns validated structured answers in question order.
 */
export function clarificationAnswers(
  questions: readonly Question[],
  values: ClarificationValues,
): Answer[] {
  const answers: Answer[] = []
  for (const question of questions) {
    switch (question.type) {
      case 'page-count':
        if (values.pageCount === undefined) throw new Error('Page count is required')
        answers.push({ type: question.type, count: values.pageCount })
        break
      case 'module-parallelism':
        if (values.moduleCount === undefined || values.parallelism === undefined) {
          throw new Error('Module count and parallelism are required')
        }
        answers.push({
          type: question.type,
          moduleCount: values.moduleCount,
          parallelism: values.parallelism,
        })
        break
      case 'quality-verification':
        if (values.quality === undefined) throw new Error('Verification level is required')
        answers.push({ type: question.type, level: values.quality })
        break
    }
  }
  return answers
}

/**
 * Require the plan owned by the visible team-builder step.
 * @param plan - current plan candidate.
 * @returns the present plan.
 */
export function requireTeamBuilderPlan(plan: Plan | undefined): Plan {
  if (plan === undefined) throw new Error('team builder plan is not available')
  return plan
}

/** Novice-facing requirement, clarification, recommendation, and adoption flow. */
export function TeamBuilderPage() {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [clarificationForm] = Form.useForm<ClarificationValues>()
  const [requirement, setRequirement] = useState('')
  const [projectName, setProjectName] = useState('')
  const [plan, setPlan] = useState<Plan>()
  const [answers, setAnswers] = useState<readonly Answer[]>([])
  const [adjustments, setAdjustments] = useState<readonly string[]>([])
  const [adjustment, setAdjustment] = useState('')
  const [pending, setPending] = useState<Pending>()
  const [error, setError] = useState<string>()

  const currentStep = plan === undefined ? 0 : plan.readyForRecommendation ? 2 : 1
  const recommendation = plan?.readyForRecommendation ? plan.recommendation : undefined
  const incomplete = recommendation !== undefined && recommendation.missingCapabilities.length > 0

  useEffect(() => {
    if (plan === undefined || plan.readyForRecommendation) return
    clarificationForm.setFieldsValue({
      pageCount: plan.profile.pageCount,
      moduleCount: plan.profile.independentModuleCount,
      parallelism: plan.profile.moduleParallelism,
      quality: plan.profile.qualityLevel,
    })
  }, [clarificationForm, plan])

  async function analyze(): Promise<void> {
    setPending('structuring')
    setError(undefined)
    try {
      const structured = await api.structureTeamRequirement({
        requirement: requirement.trim(),
      })
      if (!structured.readyForRecommendation) {
        setPlan({ ...structured, adjustments: [] })
        return
      }
      setPending('recommending')
      const next = await api.recommendTeam({
        requirement: requirement.trim(),
        profile: structured.profile,
        answers: [],
        adjustments: [],
      })
      setPlan(next)
      setAnswers([])
      setAdjustments([])
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.errors.recommendTeam,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function recommend(values: ClarificationValues): Promise<void> {
    const currentPlan = requireTeamBuilderPlan(plan)
    setPending('recommending')
    setError(undefined)
    try {
      const nextAnswers = clarificationAnswers(currentPlan.questions, values)
      const next = await api.recommendTeam({
        requirement: requirement.trim(),
        profile: currentPlan.profile,
        answers: nextAnswers,
        adjustments: [],
      })
      setAnswers(nextAnswers)
      setPlan(next)
      setAdjustments([])
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.errors.recommendTeam,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function adjust(): Promise<void> {
    if (adjustment.trim() === '') return
    const currentPlan = requireTeamBuilderPlan(plan)
    setPending('adjusting')
    setError(undefined)
    try {
      const nextAdjustments = [...adjustments, adjustment.trim()]
      const next = await api.adjustTeamRecommendation({
        requirement: requirement.trim(),
        profile: currentPlan.profile,
        answers: [...answers],
        adjustments: nextAdjustments,
      })
      setPlan(next)
      setAdjustments(nextAdjustments)
      setAdjustment('')
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.errors.adjustTeam,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function adopt(): Promise<void> {
    if (incomplete || projectName.trim() === '') return
    const currentPlan = requireTeamBuilderPlan(plan)
    setPending('adopting')
    setError(undefined)
    try {
      const adopted = await api.adoptTeam({
        requirement: requirement.trim(),
        profile: currentPlan.profile,
        answers: [...answers],
        adjustments: [...adjustments],
        projectName: projectName.trim(),
      })
      message.success(dictionary.teamBuilder.adopted)
      navigate(`/projects/${encodeURIComponent(adopted.projectId)}`)
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.errors.adoptTeam,
      ))
    } finally {
      setPending(undefined)
    }
  }

  function reset(): void {
    setPlan(undefined)
    setAnswers([])
    setAdjustments([])
    setAdjustment('')
    setError(undefined)
  }

  return (
    <div className="page-stack team-builder-page">
      <PageHeading
        title={dictionary.teamBuilder.title}
        description={dictionary.teamBuilder.description}
      />
      <Steps
        current={currentStep}
        items={[
          { title: dictionary.teamBuilder.steps.requirement },
          { title: dictionary.teamBuilder.steps.clarify },
          { title: dictionary.teamBuilder.steps.recommendation },
        ]}
      />
      {error === undefined ? null : (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => { setError(undefined) }}
        />
      )}

      {plan === undefined ? (
        <section className="section-panel team-builder-requirement">
          <label className="team-builder-label" htmlFor="team-requirement">
            {dictionary.teamBuilder.requirementLabel}
          </label>
          <Input.TextArea
            id="team-requirement"
            rows={7}
            maxLength={4_000}
            showCount
            value={requirement}
            placeholder={dictionary.teamBuilder.requirementPlaceholder}
            onChange={(event) => { setRequirement(event.target.value) }}
          />
          <div className="team-builder-actions">
            <Button
              type="primary"
              icon={<RobotOutlined />}
              disabled={requirement.trim() === ''}
              loading={pending === 'structuring' || pending === 'recommending'}
              onClick={() => { void analyze() }}
            >
              {pending === 'structuring' || pending === 'recommending'
                ? dictionary.teamBuilder.clarifying
                : dictionary.teamBuilder.analyze}
            </Button>
          </div>
        </section>
      ) : null}

      {plan !== undefined && !plan.readyForRecommendation ? (
        <section className="section-panel team-builder-clarification">
          <h3>{dictionary.teamBuilder.questionsTitle}</h3>
          <Form<ClarificationValues>
            form={clarificationForm}
            layout="vertical"
            onFinish={(values) => { void recommend(values) }}
          >
            {plan.questions.map(question => (
              <QuestionField
                key={question.type}
                question={question}
                dictionary={dictionary}
              />
            ))}
            <Form.Item>
              <Space wrap>
                <Button icon={<ArrowLeftOutlined />} onClick={reset}>
                  {dictionary.teamBuilder.back}
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<ArrowRightOutlined />}
                  loading={pending === 'recommending'}
                >
                  {dictionary.teamBuilder.recommend}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </section>
      ) : null}

      {plan?.readyForRecommendation && recommendation !== undefined ? (
        <>
          <ProfileSummary plan={plan} />
          <TeamRecommendationDetails recommendation={recommendation} />
          {incomplete ? (
            <Alert
              type="error"
              showIcon
              title={dictionary.teamBuilder.incomplete}
            />
          ) : null}
          <section className="section-panel">
            <h3>{dictionary.teamBuilder.adjustmentLabel}</h3>
            <div className="team-builder-adjustment">
              <Input
                value={adjustment}
                maxLength={2_000}
                placeholder={dictionary.teamBuilder.adjustmentPlaceholder}
                onChange={(event) => { setAdjustment(event.target.value) }}
                onPressEnter={() => { void adjust() }}
              />
              <Button
                loading={pending === 'adjusting'}
                disabled={adjustment.trim() === ''}
                onClick={() => { void adjust() }}
              >
                {dictionary.teamBuilder.adjust}
              </Button>
            </div>
            <div className="team-adjustment-history">
              <span className="agent-metric-label">
                {dictionary.teamBuilder.adjustmentsTitle}
              </span>
              {plan.adjustments.length === 0 ? (
                <span>{dictionary.teamBuilder.adjustmentEmpty}</span>
              ) : plan.adjustments.map((entry, index) => (
                <span key={`${entry.intent.type}-${String(index)}`}>
                  {adjustmentLabel(dictionary, entry)}
                </span>
              ))}
            </div>
          </section>
          <section className="section-panel team-builder-adopt">
            <h3>{dictionary.teamBuilder.adoptTitle}</h3>
            <Space.Compact className="team-builder-adopt-controls">
              <Input
                value={projectName}
                maxLength={120}
                placeholder={dictionary.teamBuilder.projectNamePlaceholder}
                onChange={(event) => { setProjectName(event.target.value) }}
                onPressEnter={() => { void adopt() }}
              />
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={pending === 'adopting'}
                disabled={projectName.trim() === '' || incomplete}
                onClick={() => { void adopt() }}
              >
                {dictionary.teamBuilder.adopt}
              </Button>
            </Space.Compact>
          </section>
        </>
      ) : null}
    </div>
  )
}

/**
 * Render one structured clarification input.
 * @param props - question contract and localized dictionary.
 * @returns the matching Ant Design form control.
 */
export function QuestionField({
  question,
  dictionary,
}: {
  readonly question: Question
  readonly dictionary: ReturnType<typeof useLocale>['dictionary']
}) {
  const label = questionPrompt(dictionary, question.type)
  switch (question.type) {
    case 'page-count':
      return (
        <Form.Item
          name="pageCount"
          label={dictionary.teamBuilder.pageCount}
          extra={label}
          rules={[{ required: true }]}
        >
          <InputNumber min={question.minimum} max={question.maximum} />
        </Form.Item>
      )
    case 'module-parallelism':
      return (
        <>
          <Form.Item
            name="moduleCount"
            label={dictionary.teamBuilder.moduleCount}
            extra={label}
            rules={[{ required: true }]}
          >
            <InputNumber
              min={question.minimumModuleCount}
              max={question.maximumModuleCount}
            />
          </Form.Item>
          <Form.Item
            name="parallelism"
            label={dictionary.teamBuilder.parallelism}
            rules={[{ required: true }]}
          >
            <Select
              options={question.options.map(option => ({
                value: option.value,
                label: parallelismLabel(dictionary, option.value),
              }))}
            />
          </Form.Item>
        </>
      )
    case 'quality-verification':
      return (
        <Form.Item
          name="quality"
          label={dictionary.teamBuilder.quality}
          extra={label}
          rules={[{ required: true }]}
        >
          <Select
            options={question.options.map(option => ({
              value: option.value,
              label: qualityLabel(dictionary, option.value),
            }))}
          />
        </Form.Item>
      )
  }
}

/**
 * Render the canonical project profile used for recommendation.
 * @param plan - browser-safe recommendation plan.
 * @returns the profile summary panel.
 */
export function ProfileSummary({ plan }: { readonly plan: Plan }) {
  const { dictionary } = useLocale()
  const profile = plan.profile
  return (
    <section className="section-panel">
      <h3>{dictionary.teamBuilder.profileTitle}</h3>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label={dictionary.teamBuilder.pages}>
          {profile.pageCount ?? '-'}
        </Descriptions.Item>
        <Descriptions.Item label={dictionary.teamBuilder.modules}>
          {profile.independentModuleCount ?? '-'}
        </Descriptions.Item>
        <Descriptions.Item label={dictionary.teamBuilder.design}>
          {profile.designComplexity === undefined
            ? '-'
            : designLabel(dictionary, profile.designComplexity)}
        </Descriptions.Item>
        <Descriptions.Item label={dictionary.teamBuilder.testingRequired}>
          {profile.testingRequired === true
            ? dictionary.teamBuilder.yes
            : dictionary.teamBuilder.no}
        </Descriptions.Item>
        <Descriptions.Item label={dictionary.teamBuilder.budget}>
          {profile.budgetPreference === undefined
            ? '-'
            : budgetLabel(dictionary, profile.budgetPreference)}
        </Descriptions.Item>
        <Descriptions.Item label={dictionary.teamBuilder.timePreference}>
          {profile.timePreference === undefined
            ? '-'
            : timeLabel(dictionary, profile.timePreference)}
        </Descriptions.Item>
        <Descriptions.Item label={dictionary.teamBuilder.techStack} span={3}>
          {profile.techStack?.join(', ') ?? '-'}
        </Descriptions.Item>
      </Descriptions>
    </section>
  )
}
