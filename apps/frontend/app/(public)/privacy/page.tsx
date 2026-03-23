import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Home
            </Button>
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-gray-600">
            <strong>Last updated:</strong> October 10, 2025
          </p>
        </div>

        {/* Content */}
        <div className="bg-white rounded-lg shadow-sm border p-8 space-y-8">
          <div>
            <p className="text-lg text-gray-700 leading-relaxed">
              ComplyFlow processes requirements documents and draft SOW content that you upload
              directly in the app. We use this content to generate semantic links and citations
              for your team workflow. We do not sell your data.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Access</h2>
            <p className="text-gray-700 leading-relaxed">
              We only process documents and text that you explicitly upload or paste into the
              application. Access is scoped by team and organization membership through
              row-level security controls.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Storage</h2>
            <p className="text-gray-700 leading-relaxed">
              Document text, chunk metadata, and section-linking results are stored in your
              Supabase project so your team can review and edit traceability outputs.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">User Consent</h2>
            <p className="text-gray-700 leading-relaxed">
              You control uploads and can delete records from your workspace at any time.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Security</h2>
            <p className="text-gray-700 leading-relaxed">
              We implement industry-standard security measures to protect your data during
              transmission and processing, including HTTPS/TLS and Supabase access controls.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Third-Party Services</h2>
            <p className="text-gray-700 leading-relaxed">
              ComplyFlow may use AI providers for embedding and assistant responses. Provider
              usage is governed by your configured API credentials and provider terms.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Changes to This Policy</h2>
            <p className="text-gray-700 leading-relaxed">
              We may update this privacy policy from time to time. We will notify users of any 
              material changes by posting the new privacy policy on this page and updating the 
              "Last updated" date.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Contact</h2>
            <p className="text-gray-700 leading-relaxed">
              For privacy-related questions, contact us at{' '}
              <a 
                href="mailto:support@complyflow.ai" 
                className="text-blue-600 hover:text-blue-800 underline"
              >
                support@complyflow.ai
              </a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
