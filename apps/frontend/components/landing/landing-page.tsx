import { WaitlistForm } from './waitlist-form';
import { Shield, Target, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-gray-900">GrantComply</span>
            </div>
            <div className="text-sm text-gray-600">
              Coming Soon
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6">
              AI-Powered Grant
              <span className="text-blue-600"> Compliance</span>
              <br />
              Made Simple
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
              Transform your grant application process with intelligent compliance checking, 
              proposal repurposing, and deadline management.
            </p>
            
            {/* Waitlist Form */}
            <div className="mb-8">
              <WaitlistForm />
            </div>

            {/* Demo Link */}
            <div className="mb-12">
              <Link href="/check">
                <Button variant="outline" size="lg" className="text-blue-600 border-blue-600 hover:bg-blue-50">
                  Try PDF Analysis Demo
                </Button>
              </Link>
            </div>

          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="text-center p-6 bg-white rounded-lg shadow-sm border">
              <Shield className="h-12 w-12 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Compliance Checking
              </h3>
              <p className="text-gray-600">
                Automatically verify your proposals against funder requirements and guidelines.
              </p>
            </div>

            <div className="text-center p-6 bg-white rounded-lg shadow-sm border">
              <Target className="h-12 w-12 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Proposal Repurposing
              </h3>
              <p className="text-gray-600">
                Intelligently adapt existing proposals for new opportunities and funders.
              </p>
            </div>

            <div className="text-center p-6 bg-white rounded-lg shadow-sm border">
              <CheckCircle className="h-12 w-12 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Workflow Management
              </h3>
              <p className="text-gray-600">
                Track deadlines, manage applications, and collaborate with your team.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="text-sm text-gray-600">
              © 2025 GrantComply. All rights reserved.
            </div>
            <div className="flex space-x-6 text-sm">
              <Link href="/privacy" className="text-gray-600 hover:text-gray-900">
                Privacy Policy
              </Link>
              <a
                href="mailto:support@grantcomply.ai"
                className="text-gray-600 hover:text-gray-900"
              >
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
