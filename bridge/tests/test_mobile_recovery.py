"""A phone may disconnect; the host owns the run and the pin."""
import unittest
import test_bridge


class MobileRecoveryTest(unittest.TestCase):
    # Reuse setup/helpers, without running the parent's test cases twice.
    setUp = test_bridge.BridgeTest.setUp
    tearDown = test_bridge.BridgeTest.tearDown
    call = test_bridge.BridgeTest.call

    def test_pins_are_saved_on_host_without_replacing_other_preferences(self):
        self.call('PUT', '/v1/prefs', {'prefs': {'picks': {'nova': {'model': 'keep'}}}})
        status, body = self.call('PUT', '/v1/bots/nova/pin', {'pinned': True})
        self.assertEqual(status, 200, body)
        saved = self.call('GET', '/v1/prefs')[1]['prefs']
        self.assertTrue(saved['mobilePinnedBots']['nova'])
        self.assertEqual(saved['picks']['nova']['model'], 'keep')
        self.assertEqual(self.call('PUT', '/v1/bots/nova/pin', {'pinned': False})[0], 200)
        self.assertFalse(self.call('GET', '/v1/prefs')[1]['prefs']['mobilePinnedBots']['nova'])

    def test_detached_run_reconnects_without_submitting_the_message_twice(self):
        path = '/v1/sessions/default/s-primary-1/turns/mobile-request-1'
        status, first = self.call('PUT', path, {'message': 'hello'})
        self.assertEqual(status, 202, first)
        status, second = self.call('PUT', path, {'message': 'hello'})
        self.assertEqual(status, 202, second)
        self.assertEqual(first['run']['id'], second['run']['id'])
        self.assertEqual(self.fake.run_starts, 1)
        status, result = self.call('GET', path)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['run']['text'], 'Detached reply')
        self.assertEqual(result['run']['status'], 'completed')
        # The mapping is on disk, not tied to a client socket or bridge instance.
        from hermes_bridge.turns import Turns
        restored = Turns(self.config, self.server.bridge.hermes)
        self.assertEqual(restored.get('default', 's-primary-1', 'mobile-request-1')['text'], 'Detached reply')

    def test_same_request_id_cannot_run_different_content(self):
        path = '/v1/sessions/nova/s-nova-1/turns/mobile-request-2'
        self.assertEqual(self.call('PUT', path, {'message': 'first'})[0], 202)
        status, body = self.call('PUT', path, {'message': 'different'})
        self.assertEqual(status, 409, body)
        self.assertEqual(self.fake.run_starts, 1)

    def test_pending_runs_can_be_found_after_reopening_app_and_explicitly_stopped(self):
        self.fake.run_state = 'running'
        path = '/v1/sessions/nova/s-nova-1/turns/mobile-request-3'
        self.assertEqual(self.call('PUT', path, {'message': 'slow'})[0], 202)
        status, body = self.call('GET', '/v1/active-turns')
        self.assertEqual(status, 200, body)
        self.assertEqual(body['runs'][0]['bot'], 'nova')
        self.assertEqual(body['runs'][0]['sessionId'], 's-nova-1')
        self.assertEqual(self.call('POST', path + '/stop', {})[0], 200)
        self.assertEqual(self.call('GET', path)[1]['run']['status'], 'cancelled')
        self.assertEqual(self.call('GET', '/v1/active-turns')[1]['runs'], [])

    def test_run_forgotten_by_hermes_does_not_break_the_active_list(self):
        # A gateway restart drops in-memory runs; the bridge still holds the
        # reference. That must not turn the whole refresh into "offline".
        self.fake.run_state = 'running'
        gone = '/v1/sessions/nova/s-nova-1/turns/mobile-request-gone'
        live = '/v1/sessions/default/s-primary-1/turns/mobile-request-live'
        self.assertEqual(self.call('PUT', gone, {'message': 'lost'})[0], 202)
        self.assertEqual(self.call('PUT', live, {'message': 'kept'})[0], 202)
        for key in [k for k in self.fake.detached_runs if k[0] == 'nova']:
            del self.fake.detached_runs[key]
        status, body = self.call('GET', '/v1/active-turns')
        self.assertEqual(status, 200, body)
        self.assertEqual([run['bot'] for run in body['runs']], ['default'])
        # The stale reference is retired, so later refreshes skip it entirely.
        self.assertEqual(self.call('GET', '/v1/active-turns')[1]['runs'][0]['bot'], 'default')

